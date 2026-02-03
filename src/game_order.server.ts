import express from "express";
import { Server } from "socket.io";
import { createServer, get } from "http";
import { createClient } from "redis";
import "dotenv/config";
import axios from "axios";

const ANALYTICS_URL =
  "https://webhook.site/50a6c143-57eb-4e3f-b559-4f3ecff0728c";

const app = express();
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const redisClient = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

const subscriber = redisClient.duplicate();

async function getLeaderboard() {
  const scores = await redisClient.zRangeWithScores("leaderboard", 0, 9, {
    REV: true,
  });
  return scores.map((item) => ({
    username: item.value,
    score: item.score,
  }));
}

async function init() {
  await redisClient.connect();
  await subscriber.connect();

  console.log("Connected to Redis");

  await subscriber.subscribe("leaderboard_update", async () => {
    const data = await getLeaderboard();
    console.log("Broadcasting leaderboard update to all clients");
    io.emit("update_leaderboard", data);
  });

  //ANALYTICS
  await subscriber.subscribe("order_placed", async (message: any) => {
    const data = JSON.parse(message);
    console.log(`Webhook sending analytics for order #${data.orderId}...`);
    const payload = {
      event: "PURCHASE_COMPLETED",
      timeStamp: new Date().toISOString(),
      metadata: {
        order_id: data.orderId,
        customer_id: data.userId,
        platform: "customer-backend",
      },
    };
    try {
      const response = await axios.post(ANALYTICS_URL, payload, {
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "secret-key",
        },
        timeout: 5000,
      });

      console.log(`Webhook Successfully devivered. Status: ${response.status}`);
    } catch (err: any) {
      console.log(`Webhook failed to send: ${err.message}`);
    }
  });
}

io.on("connection", async (socket) => {
  console.log(`A client connected: ${socket.id}`);

  // Send current data immediately on connect
  const data = await getLeaderboard();
  socket.emit("current_leaderboard", data);
});

app.get("/leaderboard-feed", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  console.log("Client joined SSE feed")

  const sendUpdate = async () => {
    const data = await getLeaderboard();
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  sendUpdate();

  const sub = redisClient.duplicate();
  await sub.connect();

  await sub.subscribe("leaderboard_update", sendUpdate);

  req.on("close", async () => {
    console.log("Client left SSE feed");
    await sub.unsubscribe("leaderboard_update", sendUpdate);
    await sub.quit();
    res.end();
  })
  
})

app.post("/score", async (req, res) => {
  const { username, score } = req.body;
  await redisClient.zAdd("leaderboard", {
    score: Number(score),
    value: username,
  });
  await redisClient.publish("leaderboard_update", "changed");
  res
    .status(200)
    .json({ success: true, message: "Score updated successfully" });
});

app.post("/seed", async (req, res) => {
  const players = [
    { score: 100, value: "Player 1" },
    { score: 90, value: "Player 2" },
    { score: 80, value: "Player 3" },
    { score: 70, value: "Player 4" },
    { score: 60, value: "Player 5" },
    { score: 50, value: "Player 6" },
    { score: 40, value: "Player 7" },
    { score: 30, value: "Player 8" },
    { score: 20, value: "Player 9" },
    { score: 10, value: "Player 10" },
  ];
  await redisClient.del("leaderboard");
  await redisClient.zAdd(
    "leaderboard",
    players.map((player) => ({ score: player.score, value: player.value }))
  );
  await redisClient.publish("leaderboard_update", "seeded");

  res
    .status(200)
    .json({ success: true, message: "Leaderboard seeded successfully" });
});

app.post("/place_order", async (req, res) => {
  const order_details = {
    oredrId: req.body.orderId,
    userId: req.body.userId,
  };
  redisClient.publish("order_placed", JSON.stringify(order_details));

  res.status(200).json({ success: true, message: "Order Placed" });
});

httpServer.listen(3011, async () => {
  console.log("Server is running on port 3011");
  await init();
});

import { createClient } from "redis";
import "dotenv/config";

const subscriber = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

async function warehouseServiceRun() {
  await subscriber.connect();
  console.log("Warehouse Service Listening...");

  subscriber.subscribe("image_uploaded", (message) => {
    const data = JSON.parse(message);
    console.log(`[Worker_1][Warehouse] Processing order ${data.userId}...`);
  });
}

export default warehouseServiceRun;

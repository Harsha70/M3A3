import express, { type Request, type Response } from "express";
import { createClient } from "redis";
import prisma from "../db.ts";
import warehouseServiceRun from "./workers/service_warehouse.ts";
import emailServiceRun from "./workers/service_email.ts";
import thumbnailServiceRun from "./workers/service_thumbnail.ts";
import "dotenv/config";

const app = express();
app.use(express.json());

const statusNotifier = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

const publisher = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

publisher.connect();

warehouseServiceRun();
emailServiceRun();
thumbnailServiceRun();

app.post("/enqueue", async (req: Request, res: Response) => {
  const { userId, imagePath } = req.body;

  await publisher.publish(
    "image_uploaded",
    JSON.stringify({ userId, imagePath })
  );

  res.status(200).json({ message: "Image received and event broadcasted!" });
});

app.get("/status/:userId", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { thumbnailImage: true },
  });
  if (!user) {
    return res.status(404).json({ status: "error", message: "User not found" });
  }
  if (user.thumbnailImage) {
    return res.json({
      status: "done",
      thumbnailUrl: user.thumbnailImage,
    });
  }
  return res.json({
    status: "pending",
    message: "Thumbnail is still being generated.",
  });
});

app.get("/status-live/:userId", async (req: Request, res: Response) => {
  const { userId } = req.params;
  const channel = `finished:${userId}`;

  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { thumbnailImage: true },
  });

  if (user?.thumbnailImage) {
    return res.json({ status: "done", thumbnailUrl: user.thumbnailImage });
  }

  console.log(`[API] Holding request for User ${userId}...`);

  await statusNotifier.connect();

  const cleanup = async () => {
    if (statusNotifier.isOpen) {
      console.log(`cleaning up ${channel}`);
      await statusNotifier.unsubscribe(channel);
      await statusNotifier.quit();
      clearTimeout(timeout);
    }
  };

  await statusNotifier.subscribe(channel, (message) => {
    const data = JSON.parse(message);
    console.log(`${userId} thumbnail ready!`);
    cleanup();

    if (!res.writableEnded) {
      res.json({ status: data.status, thumbnailUrl: data.url });
    }
  });

  const timeout = setTimeout(async () => {
    console.log(`[API] Request timed out for User ${userId}`);
    cleanup();
    if (!res.writableEnded) {
      res.status(408).send({
        status: "pending",
        message: "Request timed out. Please try again.",
      });
    }
  }, 30000);
});


app.listen(3010, () => {
  console.log("Server running on port 3010");
});

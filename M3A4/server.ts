import express, { type Request, type Response } from "express";
import { createClient } from "redis";
import { v4 as uuidv4 } from "uuid";
import prisma from "../db.ts";
import "dotenv/config";

const app = express();
app.use(express.json());

const client = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

const producer = client.duplicate();

const QUEUE_NAME = "video_tasks";
const STATUS_PREFIX = "job_status:";

async function init() {
  await producer.connect();
  console.log("API connected to Redis");
}

app.post("/process", async (req, res) => {
  const { videoUrl } = req.body;
  const jobId = uuidv4();

  const task = {
    id: jobId,
    url: videoUrl,
    retryCount: 0,
    createdAt: Date.now(),
  };

  await producer.set(
    `${STATUS_PREFIX}${jobId}`,
    JSON.stringify({
      status: "queued",
      progress: 0,
    }),
    { EX: 3600 }
  );

  await producer.rPush(QUEUE_NAME, JSON.stringify(task));

  res.status(202).json({
    jobId,
    message: "Video processing started",
    checkStatus: `/status/${jobId}`,
  });
});

app.get("/status/:id", async (req, res) => {
  const status = await producer.get(`${STATUS_PREFIX}${req.params.id}`);

  if (!status) return res.status(404).json({ error: "Job not found" });
  res.json(JSON.parse(status));
});

app.listen(3000, () => {
  init();
  console.log("API Server running on http://localhost:3000");
});

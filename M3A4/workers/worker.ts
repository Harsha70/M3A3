import { createClient } from "redis";
import "dotenv/config";

const client = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

const QUEUE_NAME = "video_tasks";
const DLQ = "video_tasks_dead";
const STATUS_PREFIX = "job_status:";

async function startWorker() {
  await client.connect();
  console.log("Worker online. Listening for videos tasks ...");

  while (true) {
    // BLPOP blocks until a message is available in 'task_queue'
    const result = await client.blPop(QUEUE_NAME, 0);
    console.log("result", result);
    if (!result) continue;

    const task = JSON.parse(result.element);
    const statusKey = `${STATUS_PREFIX}${task.id}`;
    console.log(statusKey);
    try {
      await client.set(
        statusKey,
        JSON.stringify({ status: "processing", progress: 10 }),
        { EX: 3600 }
      );
      console.log(`Transcoding: ${task.id}`);

      // Simulated Heavy work
      if (task.url == "fail-me") throw new Error("Codec Error");
      await new Promise((r) => setTimeout(r, 3000));

      console.log("-------------------------------");

      await client.set(
        statusKey,
        JSON.stringify({
          status: "completed",
          progress: 100,
          result: `processed_${task.id}.mp4`,
        }),
        { EX: 3600 }
      );
    } catch (err: any) {
      task.retryCount++;
      console.log(`Failed: ${task.id}. Attempt: ${task.retryCount}`);
      if (task.retryCount >= 3) {
        await client.rPush(DLQ, JSON.stringify(task));
        await client.set(
          statusKey,
          JSON.stringify({ status: "failed", error: err.message })
        );
      } else {
        await client.rPush(QUEUE_NAME, JSON.stringify(task));
      }
    }
  }
}
startWorker();

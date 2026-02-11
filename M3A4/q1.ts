import { createClient } from "redis";
import "dotenv/config";

const MAIN_QUEUE = "task_queue";
const DLQ = "task_queue_dead";
const MAX_RETRIES = 3;

const producer = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

async function seed() {
  await producer.connect();
  const tasks = [
    { id: "A", data: "valid", retryCount: 0 },
    { id: "B", data: "valid", retryCount: 0 },
    { id: "C", data: "corrupt", retryCount: 0 },
    { id: "D", data: "valid", retryCount: 0 },
  ];

  for (const task of tasks) {
    await producer.rPush("task_queue", JSON.stringify(task));
  }

  console.log("4 Tasks enqueued (A, B, C, D)");
  await producer.quit();
}

seed();

const client = producer.duplicate();
async function startWorker() {
  await client.connect();
  console.log("Worker online. Listening for tasks...");

  while (true) {
    const result = await client.blPop(MAIN_QUEUE, 0);
    if (!result) continue;

    const rawMessage = result.element;
    const task = JSON.parse(rawMessage);

    try {
      console.log(
        `Processing Task: ${task.id} (Attempt: ${task.retryCount || 0})`
      );

      await processTaskLogic(task);

      console.log(`Task ${task.id} completed successfully.`);
    } catch (error: any) {
      console.error(`Error in Task ${task.id}: ${error.message}`);

      task.retryCount = (task.retryCount || 0) + 1;

      if (task.retryCount >= MAX_RETRIES) {
        console.log(
          `Task ${task.id} failed ${MAX_RETRIES} times. Moving to DLQ.`
        );
        await client.rPush(DLQ, JSON.stringify(task));
      } else {
        console.log(
          `Retrying Task ${task.id} (Total retries: ${task.retryCount})...`
        );
        await client.rPush(MAIN_QUEUE, JSON.stringify(task));
      }
    }
  }
}

async function processTaskLogic(task: any) {
  if (task.id === "C") {
    throw new Error("Invalid data format in message C");
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
}

startWorker().catch(console.error);

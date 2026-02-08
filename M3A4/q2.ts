import { createClient } from "redis";
import "dotenv/config";

const MAIN_QUEUE = "task_queue";
const RETRY_QUEUE = "task_queue_retry";
const MAX_RETRIES = 3;

function createRedisClient() {
  return createClient({
    username: process.env.REDIS_USERNAME || "",
    password: process.env.REDIS_PASSWORD || "",
    socket: {
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT || 6379),
    },
  });
}

const producer = createRedisClient();
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

const client = createRedisClient();
const client2 = createRedisClient();

async function startMainWorker() {
  await client.connect();
  console.log("Main Worker online. Listening for tasks...");

  while (true) {
    // 1. Dequeue: Get the next task (Blocking Pop)
    const result = await client.blPop(MAIN_QUEUE, 0);
    if (!result) continue;

    const rawMessage = result!.element;
    const task = JSON.parse(rawMessage);

    try {
      console.log(
        `Processing Task: ${task.id} (Attempt: ${task.retryCount || 0})`
      );

      // 2. Execute Business Logic
      await processTaskLogic(task);

      console.log(`Task ${task.id} completed successfully.`);
    } catch (error: any) {
      console.error(
        `Error in Task ${task.id}: ${error.message} and Moving to retry queue`
      );
      await client.rPush(RETRY_QUEUE, JSON.stringify(task));
    }
  }
}

const DLQ = "task_queue_dead";

async function startRetryWorker() {
  await client2.connect();
  console.log("Retry Worker: Handling the failed tasks");

  while (true) {
    const result = await client2.blPop(RETRY_QUEUE, 0);
    if (!result) continue;
    const task = JSON.parse(result.element);
    try {
      await new Promise((r) => setTimeout(r, 5000));
      await processTaskLogic(task);
      console.log(`Retry successful for ${task.id}`);
    } catch (error: any) {
      task.retryCount = (task.retryCount || 0) + 1;

      if (task.retryCount >= MAX_RETRIES) {
        console.log(`Task ${task.id} dead. Moving to DLQ`);
        await client2.rPush(DLQ, JSON.stringify(task));
      } else {
        await client2.rPush(RETRY_QUEUE, JSON.stringify(task));
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

(async () => {
  await seed();
  void startMainWorker();
  void startRetryWorker();
})();

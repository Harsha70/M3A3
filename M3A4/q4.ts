import { createClient } from "redis";
import "dotenv/config";

const MAIN_QUEUE = "task_queue";
const RETRY_QUEUE = "task_queue_retry";
const RETRY_QUEUE_2 = "task_queue_retry_2";
const DLQ = "task_queue_dead";

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

async function seed() {
  const producer = createRedisClient();
  await producer.connect();

  const tasks = [
    { id: "A", data: "valid", retryCount: 0 },
    { id: "B", data: "valid", retryCount: 0 },
    { id: "C", data: "corrupt", retryCount: 0 },
    { id: "D", data: "valid", retryCount: 0 },
  ];

  for (const task of tasks) {
    await producer.rPush(MAIN_QUEUE, JSON.stringify(task));
  }

  console.log("Seeded tasks A, B, C, D");
  await producer.quit();
}

async function startMainWorker() {
  const client = createRedisClient();
  await client.connect();

  console.log("Main Worker running");

  while (true) {
    const result = await client.blPop(MAIN_QUEUE, 0);
    if (!result) continue;

    const task = JSON.parse(result.element);

    try {
      console.log(`Main Processing ${task.id} | Retry ${task.retryCount}`);
      await processTaskLogic(task);
      console.log(`Main Success ${task.id}`);
    } catch (err: any) {
      console.log(`Main Failed ${task.id} → Retry Queue`);
      task.retryCount = (task.retryCount || 0) + 1;
      await client.rPush(RETRY_QUEUE, JSON.stringify(task));
    }
  }
}

async function startRetryWorker() {
  const client = createRedisClient();
  await client.connect();

  console.log("Retry Worker running");

  while (true) {
    const result = await client.blPop(RETRY_QUEUE, 0);
    if (!result) continue;

    const task = JSON.parse(result.element);

    try {
      console.log(`Retry Processing ${task.id} | Retry ${task.retryCount}`);
      await processTaskLogic(task);
      console.log(`Retry Success ${task.id}`);
    } catch (err: any) {
      console.log(`Retry Failed ${task.id} → Retry2 Queue`);
      task.retryCount++;
      await client.rPush(RETRY_QUEUE_2, JSON.stringify(task));
    }
  }
}

async function startSecondRetryWorker() {
  const client = createRedisClient();
  await client.connect();

  console.log("Second Retry Worker running");

  while (true) {
    const result = await client.blPop(RETRY_QUEUE_2, 0);
    if (!result) continue;

    const task = JSON.parse(result.element);

    try {
      console.log(`Retry2 Processing ${task.id} | Retry ${task.retryCount}`);
      await processTaskLogic(task);
      console.log(`Retry2 Success ${task.id}`);
    } catch (err) {
      task.retryCount++;

      if (task.retryCount >= MAX_RETRIES) {
        console.log(`${task.id} → DLQ`);
        await client.rPush(DLQ, JSON.stringify(task));
      } else {
        console.log(`♻ Requeue ${task.id} → Retry2`);
        await client.rPush(RETRY_QUEUE_2, JSON.stringify(task));
      }
    }
  }
}

async function processTaskLogic(task: any) {
  if (task.id === "C") {
    throw new Error("Invalid data format");
  }

  await new Promise((r) => setTimeout(r, 2000));
}

async function start() {
  await seed();

  startMainWorker();
  startRetryWorker();
  startSecondRetryWorker();
}

start().catch(console.error);

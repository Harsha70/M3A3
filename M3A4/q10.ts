/**
 * q10: Same behaviour as q6 (task queue, retries, exponential backoff, DLQ, email alert)
 * but implemented with BullMQ instead of raw Redis lists.
 *
 * --- What was EASY with BullMQ vs q6 (first principles) ---
 * • No manual queue wiring: one Queue + one Worker replace main queue, retry queue,
 *   and separate main/retry workers. No blPop loops or multiple Redis clients for queues.
 * • Retries + backoff are declarative: `attempts: 4` and `backoff: { type: 'exponential', delay: 1000 }`
 *   replace custom retry queue, retry worker loop, and getBackoffDelayMs().
 * • Failed jobs are stored and queryable by BullMQ; no separate DLQ Redis list unless we want it.
 * • Less code: no seed() that quits a producer, no careful separation of main vs retry clients.
 *
 * --- What was HARD or required care ---
 * • Different Redis client: BullMQ uses ioredis (Redis class; connection options, maxRetriesPerRequest: null for workers),
 *   while q6 used node-redis. We still use node-redis for idempotent state (task_progress:*).
 * • DLQ alerting: BullMQ emits "failed" on every failed attempt, so we must check
 *   job.attemptsMade >= job.opts.attempts to send email only when retries are exhausted.
 * • Understanding BullMQ’s key layout and connection usage (blocking vs non-blocking) if reusing connections.
 */
import { createClient } from "redis";
import { Queue, Worker } from "bullmq";
import { Resend } from "resend";
import { Redis } from "ioredis";
import "dotenv/config";

const QUEUE_NAME = "task_queue";
const MAX_RETRIES = 3;
const DEAD_LETTER_QUEUE = "dead-letter-queue";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const ALERT_EMAIL = process.env.ALERT_EMAIL || "developer@example.com";
const ALERT_FROM =
  process.env.ALERT_FROM || "DLQ Alerts <onboarding@resend.dev>";

const redisOpts = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT || 6379),
  maxRetriesPerRequest: null,
  ...(process.env.REDIS_USERNAME && { username: process.env.REDIS_USERNAME }),
  ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
};
const connection = new Redis(redisOpts);

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

const stateClient = createRedisClient();

interface Task {
  id: string;
  userId: string;
  retryCount?: number;
}

const taskQueue = new Queue<Task>(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: MAX_RETRIES + 1,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});

async function processTask(task: Task): Promise<void> {
  const { id } = task;
  const statusKey = `task_progress:${id}`;

  if (!(await stateClient.sIsMember(statusKey, "payment_done"))) {
    console.log("Step 1: Charging payment...");
    await new Promise((r) => setTimeout(r, 5000));
    await stateClient.sAdd(statusKey, "payment_done");
    await stateClient.expire(statusKey, 86400);
  }

  if (!(await stateClient.sIsMember(statusKey, "inventory_updated"))) {
    console.log("Step 2: Updating inventory...");
    await new Promise((r) => setTimeout(r, 5000));

    if (id === "order_2") {
      throw new Error("Database connection lost during inventory update!");
    }

    await stateClient.sAdd(statusKey, "inventory_updated");
  }

  await stateClient.del(statusKey);
}

async function sendDlqAlert(task: Task): Promise<void> {
  if (!resend) {
    console.warn(
      "RESEND_API_KEY not set — skipping email alert for DLQ message:",
      task.id
    );
    return;
  }
  const subject = `[DLQ] Task ${task.id} requires manual intervention`;
  const html = `
    <h2>Dead-letter queue alert (BullMQ)</h2>
    <p>A task failed after ${MAX_RETRIES} retries.</p>
    <ul>
      <li><strong>Task ID:</strong> ${task.id}</li>
      <li><strong>User ID:</strong> ${task.userId}</li>
    </ul>
    <p>Please investigate.</p>
    <pre>${JSON.stringify(task, null, 2)}</pre>
  `;
  const { error } = await resend.emails.send({
    from: ALERT_FROM,
    to: [ALERT_EMAIL],
    subject,
    html,
  });
  if (error) {
    console.error("Failed to send DLQ alert email:", error.message);
    return;
  }
  console.log("DLQ alert email sent for task", task.id, "->", ALERT_EMAIL);
}

const worker = new Worker<Task>(
  QUEUE_NAME,
  async (job) => {
    console.log(
      `Processing Task: ${job.data.id} (Attempt: ${job.attemptsMade + 1})`
    );
    await processTask(job.data);
    console.log(`Task ${job.data.id} completed successfully.`);
  },
  {
    connection: new Redis(redisOpts),
  }
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  const attempts = job.opts.attempts ?? MAX_RETRIES + 1;
  if (job.attemptsMade >= attempts) {
    console.log(
      `Task ${job.data.id} exceeded ${MAX_RETRIES} retries → moving to dead-letter-queue + email alert`
    );
    const dlqPayload = { ...job.data, retryCount: job.attemptsMade };
    await stateClient.rPush(DEAD_LETTER_QUEUE, JSON.stringify(dlqPayload));
    await sendDlqAlert(dlqPayload);
  } else {
    console.error(
      `Task ${job.data.id} failed (attempt ${
        job.attemptsMade + 1
      }/${attempts}):`,
      err.message
    );
  }
});

async function seed() {
  await taskQueue.add("order_1", {
    id: "order_1",
    userId: "success_user",
    retryCount: 0,
  });
  await taskQueue.add("order_2", {
    id: "order_2",
    userId: "failed_user",
    retryCount: 0,
  });
  console.log("Tasks enqueued (order_1, order_2).");
}

(async () => {
  await stateClient.connect();
  await seed();
  console.log("BullMQ Worker online. Listening for tasks...");
})();

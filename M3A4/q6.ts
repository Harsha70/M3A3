import { createClient } from "redis";
import { Resend } from "resend";
import "dotenv/config";

const MAIN_QUEUE = "task_queue";
const RETRY_QUEUE = "task_queue_retry";
const DEAD_LETTER_QUEUE = "dead-letter-queue";
const MAX_RETRIES = 3;

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const ALERT_EMAIL = process.env.ALERT_EMAIL || "developer@example.com";
const ALERT_FROM =
  process.env.ALERT_FROM || "DLQ Alerts <onboarding@resend.dev>";

function getBackoffDelayMs(retryCount: number): number {
  const seconds = Math.pow(2, retryCount);
  return seconds * 1000;
}

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
const mainClient = createRedisClient();
const retryClient = createRedisClient();
const dlqClient = createRedisClient();
const stateClient = createRedisClient();

interface Task {
  id: string;
  userId: string;
  retryCount?: number;
}

async function seed() {
  await producer.connect();
  const task: Task = { id: "order_1", userId: "success_user", retryCount: 0 };
  await producer.rPush(MAIN_QUEUE, JSON.stringify(task));
  console.log("Task enqueued:", task.id);
  const task2: Task = { id: "order_2", userId: "failed_user", retryCount: 0 };
  await producer.rPush(MAIN_QUEUE, JSON.stringify(task2));
  console.log("Task enqueued:", task2.id);
  await producer.quit();
}

async function startMainWorker() {
  await mainClient.connect();
  console.log("Main Worker online. Listening for tasks...");

  while (true) {
    const result = await mainClient.blPop(MAIN_QUEUE, 0);
    if (!result) continue;

    const task: Task = JSON.parse(result.element);
    task.retryCount = task.retryCount ?? 0;

    try {
      await processTask(task);
      console.log(`Task ${task.id} completed successfully.`);
    } catch (error: any) {
      console.error(
        `Task ${task.id} failed:`,
        error.message,
        "→ sending to retry queue"
      );
      await mainClient.rPush(RETRY_QUEUE, JSON.stringify(task));
    }
  }
}

async function startRetryWorker() {
  await retryClient.connect();
  console.log(
    "Retry Worker online (with exponential backoff). Listening for failed tasks..."
  );

  while (true) {
    const result = await retryClient.blPop(RETRY_QUEUE, 0);
    if (!result) continue;

    const task: Task = JSON.parse(result.element);
    const retryCount = task.retryCount ?? 0;

    const delayMs = getBackoffDelayMs(retryCount);
    console.log(
      `Retry Worker: waiting ${delayMs / 1000}s backoff before attempt ${
        retryCount + 1
      } for task ${task.id}`
    );
    await new Promise((r) => setTimeout(r, delayMs));

    try {
      await processTask(task);
      console.log(`Retry successful for task ${task.id}`);
    } catch (error: any) {
      task.retryCount = retryCount + 1;
      console.error(
        `Retry ${task.retryCount} failed for ${task.id}:`,
        error.message
      );

      if (task.retryCount >= MAX_RETRIES) {
        console.log(
          `Task ${task.id} exceeded ${MAX_RETRIES} retries → moving to dead-letter-queue (for alerting/investigation)`
        );
        await retryClient.rPush(DEAD_LETTER_QUEUE, JSON.stringify(task));
      } else {
        await retryClient.rPush(RETRY_QUEUE, JSON.stringify(task));
      }
    }
  }
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
    <h2>Dead-letter queue alert</h2>
    <p>A task failed after ${MAX_RETRIES} retries and was moved to the dead-letter queue.</p>
    <ul>
      <li><strong>Task ID:</strong> ${task.id}</li>
      <li><strong>User ID:</strong> ${task.userId}</li>
      <li><strong>Retry count:</strong> ${task.retryCount ?? 0}</li>
    </ul>
    <p>This may indicate corrupted data or a persistent failure. Please investigate.</p>
    <pre>${JSON.stringify(task, null, 2)}</pre>
  `;
  const { data, error } = await resend.emails.send({
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

async function startDlqWorker() {
  await dlqClient.connect();
  console.log(
    "DLQ Worker online. Consuming dead-letter queue and sending email alerts..."
  );

  while (true) {
    const result = await dlqClient.blPop(DEAD_LETTER_QUEUE, 0);
    if (!result) continue;

    const task: Task = JSON.parse(result.element);
    await sendDlqAlert(task);
  }
}

async function processTask(task: Task) {
  const { id } = task;
  const statusKey = `task_progress:${id}`;

  // Charge Payment
  if (!(await stateClient.sIsMember(statusKey, "payment_done"))) {
    console.log("Step 1: Charging payment...");
    await new Promise((r) => setTimeout(r, 5000));
    await stateClient.sAdd(statusKey, "payment_done");
    await stateClient.expire(statusKey, 86400);
  }

  // Update Inventory
  if (!(await stateClient.sIsMember(statusKey, "inventory_updated"))) {
    console.log("Step 2: Updating inventory...");
    await new Promise((r) => setTimeout(r, 5000));

    // SIMULATED FAILURE (uncomment to test retries + backoff):
    if (id == "order_2") {
      throw new Error("Database connection lost during inventory update!");
    }

    await stateClient.sAdd(statusKey, "inventory_updated");
  }

  await stateClient.del(statusKey);
}

(async () => {
  await seed();
  await stateClient.connect();
  void startMainWorker();
  void startRetryWorker();
  void startDlqWorker();
})();

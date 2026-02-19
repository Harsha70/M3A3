import { initDB } from "./db.ts";

async function handleTimeouts() {
  console.log("handling edge cases");
  const db = await initDB();
  const TIMEOUT_MINUTES = 2;

  setInterval(async () => {
    console.log("Checking for stale orders...");

    const staleOrders = await db.all(`
        SELECT * FROM order_aggregates 
        WHERE is_triggered = 0 
        AND last_updated_at < datetime('now', '-${TIMEOUT_MINUTES} minutes')
      `);

    for (const order of staleOrders) {
      console.log(
        `[TIMEOUT] Order ${order.order_id} failed to complete. Triggering Compensation...`
      );

      await db.run(
        `UPDATE order_aggregates SET is_triggered = -1 WHERE order_id = ?`,
        [order.order_id]
      );

      if (order.payment_status === "AUTHORIZED") {
        console.log(`Refunding payment for ${order.order_id}...`);
      }
    }
  }, 60000);
}
handleTimeouts();

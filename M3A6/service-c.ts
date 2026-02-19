import { Kafka } from "kafkajs";
import { initDB } from "./db.ts";

const kafka = new Kafka({ brokers: ["localhost:9092"] });
const consumer = kafka.consumer({ groupId: "order-aggregator-group" });

async function start() {
  const db = await initDB();
  await consumer.connect();
  await consumer.subscribe({ topics: ["payment-events", "inventory-events"] });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = JSON.parse(message.value!.toString());
      const { order_id } = event;

      await db.run(
        `INSERT INTO order_aggregates (order_id) VALUES (?) ON CONFLICT(order_id) DO NOTHING`,
        [order_id]
      );

      if (topic === "payment-events") {
        await db.run(
          `UPDATE order_aggregates SET payment_status = 'AUTHORIZED', last_updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
          [order_id]
        );
      } else if (topic === "inventory-events") {
        await db.run(
          `UPDATE order_aggregates SET inventory_status = 'RESERVED', last_updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
          [order_id]
        );
      }

      const agg = await db.get(
        `SELECT * FROM order_aggregates WHERE order_id = ?`,
        [order_id]
      );

      if (
        agg.payment_status === "AUTHORIZED" &&
        agg.inventory_status === "RESERVED" &&
        agg.is_triggered === 0
      ) {
        console.log(
          `[SUCCESS] Order ${order_id}: All conditions met. Triggering Downstream...`
        );

        await db.run(
          `UPDATE order_aggregates SET is_triggered = 1 WHERE order_id = ?`,
          [order_id]
        );
      }
    },
  });
}

start();

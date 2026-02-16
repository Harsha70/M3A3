import { Kafka } from "kafkajs";
import type { OrderEvent } from "../types/events.js";

const kafka = new Kafka({
  brokers: [process.env.KAFKA_BROKERS ?? "127.0.0.1:9092"],
});
const consumer = kafka.consumer({ groupId: "fraud-detection-group" });

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      const rawData = message.value?.toString();
      if (!rawData) return;

      const event: OrderEvent = JSON.parse(rawData);

      console.log(
        `\n Analyzing Order: ${event.order_id} (Version: ${event.event_version})`
      );

      if (event.event_version >= 2) {
        processAdvancedFraudCheck(event);
      } else {
        processBasicFraudCheck(event);
      }
    },
  });
}

function processAdvancedFraudCheck(event: any) {
  console.log(`[V2 Success] Checking Fingerprint: ${event.device_fingerprint}`);
  console.log(`[V2 Success] Geo-locating IP: ${event.ip_address}`);
}

function processBasicFraudCheck(event: any) {
  console.log(
    `[V1 Fallback] Performing limited check for User: ${event.user_id}`
  );
}

run().catch(console.error);

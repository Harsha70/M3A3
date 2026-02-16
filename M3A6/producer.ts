// src/producer.ts
import { Kafka, Partitioners } from "kafkajs";

const kafka = new Kafka({
  brokers: [process.env.KAFKA_BROKERS ?? "127.0.0.1:9092"],
});
const producer = kafka.producer({
  createPartitioner: Partitioners.LegacyPartitioner,
  idempotent: true,
});

async function sendEvents() {
  await producer.connect();

  const events = [
    {
      event_type: "OrderPlaced",
      event_version: 1,
      order_id: "O-001",
      user_id: "U-1",
      total_amount: 50,
    },
    {
      event_type: "OrderPlaced",
      event_version: 2,
      order_id: "O-002",
      user_id: "U-2",
      total_amount: 500,
      device_fingerprint: "xf88",
      ip_address: "192.168.1.1",
      payment_method_bin: "411111",
    },
  ];

  for (const event of events) {
    await producer.send({
      topic: "orders",
      messages: [{ value: JSON.stringify(event) }],
    });
    console.log(`📤 Sent V${event.event_version} event: ${event.order_id}`);
  }

  await producer.disconnect();
}

sendEvents();

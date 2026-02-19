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

  const payment_event = [
    {
      order_id: "Order_001",
      amount: 66,
    },
    {
      order_id: "Order_002",
      amount: 65,
    },
  ];

  const inventory_event = [
    {
      order_id: "Order_001",
      inventory: 66,
    },
    {
      order_id: "Order_002",
      inventory: 65,
    },
  ];

  for (const event of events) {
    await producer.send({
      topic: "orders",
      messages: [{ value: JSON.stringify(event) }],
    });
    console.log(`Sent V${event.event_version} event: ${event.order_id}`);
  }

  for (const event of payment_event) {
    await producer.send({
      topic: "payment-events",
      messages: [{ value: JSON.stringify(event) }],
    });
    console.log("payment event sequence");
  }

  for (const event of inventory_event) {
    await producer.send({
      topic: "inventory-events",
      messages: [{ value: JSON.stringify(event) }],
    });
    console.log("inventory event sequence");
  }

  await producer.disconnect();
}

sendEvents();

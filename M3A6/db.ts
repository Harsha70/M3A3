import sqlite3 from "sqlite3";
import { open } from "sqlite";

export async function initDB() {
  const db = await open({
    filename: "./order_state.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_aggregates (
      order_id TEXT PRIMARY KEY,
      payment_status TEXT DEFAULT 'PENDING',
      inventory_status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_triggered INTEGER DEFAULT 0
    )
  `);
  return db;
}

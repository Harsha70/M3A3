# M3A3

Backend service for image uploads with thumbnail generation, Redis-backed job processing, and long-polling status API.

## Features

- **Enqueue API** – Accept image uploads and publish jobs to Redis.
- **Long-polling status** – `GET /status-live/:userId` holds until a thumbnail is ready (or timeout).
- **Background workers** – Redis subscribers for thumbnail generation, warehouse, and email.
- **SQLite + Prisma** – User and thumbnail data stored in `dev.db`.
- **Game Order server** – Socket.IO + Redis leaderboard and order API (`game_order.server.ts`) on port **3011**: scores, seed, place order, real-time leaderboard updates.
- **Game Order client** – Socket.IO client (`game_order.client.ts`) that connects to the game server and listens for leaderboard events.

## Prerequisites

- **Node.js** (v18+)
- **Redis** (for pub/sub and workers)
- **npm** or **pnpm**

## Setup

1. **Clone and install**

   ```bash
   cd M3A3
   npm install
   ```

2. **Environment**

   Create a `.env` in the project root with Redis settings:

   ```env
   REDIS_HOST=127.0.0.1
   REDIS_PORT=6379
   REDIS_USERNAME=
   REDIS_PASSWORD=
   ```

   Leave username/password empty for local Redis without auth.

3. **Database**

   Prisma uses SQLite and `dev.db`. Generate the client and run migrations:

   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```

## Scripts

| Script  | Command         | Description                                          |
| ------- | --------------- | ---------------------------------------------------- |
| `dev`   | `npm run dev`   | Start main server (port **3010**)                    |
| `dev2`  | `npm run dev2`  | Start game-order Socket.IO server                    |
| `test`  | `npm run test`  | Run Jest (may need ESM setup)                        |
| `test2` | `npm run test2` | Run Jest with Node ESM (`--experimental-vm-modules`) |

For the long-polling test, start the main server first (`npm run dev`), then run `npm run test2` in another terminal.

## API (main server, port 3010)

- **POST `/enqueue`**  
  Body: `{ "userId": number, "imagePath": string }`  
  Publishes an `image_uploaded` event to Redis. Responds with a success message.

- **GET `/status-live/:userId`**  
  Long-polling: if the user already has a thumbnail, returns immediately with `{ status: "done", thumbnailUrl }`. Otherwise holds the request until the thumbnail worker publishes completion (or 30s timeout). Returns 408 on timeout.

---

## Game Order server (port 3011)

Started with `npm run dev2`. Combines Express HTTP API and Socket.IO for real-time leaderboard updates. Uses Redis for leaderboard storage and pub/sub.

### HTTP API (game_order.server.ts)

| Method   | Endpoint       | Body / description                                                                                                                                                     |
| -------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **POST** | `/score`       | `{ "username": string, "score": number }` – Add/update a score on the leaderboard (Redis sorted set). Publishes `leaderboard_update`.                                  |
| **POST** | `/seed`        | (no body) – Reset leaderboard and seed with 10 players (Player 1–10, scores 100 down to 10). Publishes `leaderboard_update`.                                           |
| **POST** | `/place_order` | `{ "orderId": string, "userId": string }` – Publish an `order_placed` event to Redis. Analytics subscriber sends a webhook (PURCHASE_COMPLETED) to the configured URL. |

### Socket.IO (game_order.server.ts)

- **Server** runs on the same HTTP server as the Express app (port **3011**), CORS `origin: "*"`.
- **On connection**: server sends the current top-10 leaderboard with event **`current_leaderboard`** (payload: array of `{ username, score }`).
- **On Redis `leaderboard_update`**: server broadcasts the new top-10 leaderboard to all clients with event **`update_leaderboard`** (same payload shape).

### Game Order client (game_order.client.ts)

- **Socket.IO client** that connects to `http://localhost:3011`.
- **Listens for:**
  - **`current_leaderboard`** – Initial leaderboard sent when the client connects.
  - **`update_leaderboard`** – Broadcast when the leaderboard changes (e.g. after `/score` or `/seed`).
- Run the client (e.g. `npx ts-node src/game_order.client.ts` or a script) while the game server is running to see real-time leaderboard updates in the console.

## Project structure

```
M3A3/
├── prisma/
│   └── schema.prisma         # User model, SQLite
├── src/
│   ├── server.ts             # Express app, /enqueue, /status-live
│   ├── game_order.server.ts  # Express + Socket.IO on 3011: /score, /seed, /place_order, leaderboard events
│   ├── game_order.client.ts  # Socket.IO client; listens for current_leaderboard, update_leaderboard
│   └── workers/
│       ├── service_thumbnail.ts  # Subscribes to image_uploaded, writes thumbnail
│       ├── service_warehouse.ts
│       └── service_email.ts
├── utils/
│   └── retryPoll.ts          # Client helper for polling /status-live
├── test/
│   └── status-live.test.ts
├── db.ts                     # Prisma client (Better SQLite)
└── dev.db                    # SQLite database
```

## Testing

The **status-live** test calls `pollWithRetry` against `http://localhost:3010/status-live/:userId` and asserts `status === "done"` and `thumbnailUrl` is defined. Requires the main server and Redis to be running; ensure a user eventually gets a thumbnail (e.g. by enqueueing an image for that user). Use `npm run test2` to avoid ESM-related Jest errors.

## License

ISC

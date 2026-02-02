import { io } from "socket.io-client";

const socket = io("http://localhost:3011");

socket.on("connect", () => {
  console.log("Connected to WebSocket Server!");
});

socket.on("current_leaderboard", (data: any) => {
  console.log("\n LIVE LEADERBOARD UPDATE ");
  console.table(data);
});

socket.on("update_leaderboard", (data: any) => {
  console.log("\n Many clients updated leaderboard (Client)");
  console.table(data);
});

socket.on("connect_error", (error: any) => {
  console.error("Connection error:", error);
});

import dotenv from "dotenv";
import http from "http";
import { createApp } from "./app.js";
import { connectDatabase } from "./utils/database.js";
import { initSocketIO } from "./utils/socket.js";

dotenv.config();

const PORT = Number(process.env.PORT || 5000);
const app = createApp();

async function startServer() {
  try {
    await connectDatabase();

    const httpServer = http.createServer(app);
    initSocketIO(httpServer, app);

    httpServer.listen(PORT, () => {
      console.log(`[MrValet] API listening on port ${PORT}`);
      console.log(`[MrValet] Socket.IO ready on port ${PORT}`);
    });
  } catch (error) {
    console.error("[MrValet] Failed to start server", error);
    process.exit(1);
  }
}

startServer();

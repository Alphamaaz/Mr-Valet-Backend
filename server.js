import dotenv from "dotenv";
import http from "http";
import { createApp } from "./app.js";
import { connectDatabase } from "./utils/database.js";
import { initSocketIO } from "./utils/socket.js";
import { autoCheckoutStaleAttendances } from "./services/attendance.service.js";

dotenv.config();

const PORT = Number(process.env.PORT || 5000);
const ATTENDANCE_AUTO_CHECKOUT_INTERVAL_MS = Number(
  process.env.ATTENDANCE_AUTO_CHECKOUT_INTERVAL_MS || 60 * 60 * 1000,
);
const app = createApp();

async function runAttendanceAutoCheckout() {
  try {
    const result = await autoCheckoutStaleAttendances();
    if (result.updatedCount > 0) {
      console.log(`[Attendance] Auto checked out ${result.updatedCount} stale attendance record(s)`);
    }
  } catch (error) {
    console.error("[Attendance] Auto checkout failed:", error?.message || error);
  }
}

async function startServer() {
  try {
    await connectDatabase();
    await runAttendanceAutoCheckout();

    const httpServer = http.createServer(app);
    initSocketIO(httpServer, app);

    if (ATTENDANCE_AUTO_CHECKOUT_INTERVAL_MS > 0) {
      setInterval(runAttendanceAutoCheckout, ATTENDANCE_AUTO_CHECKOUT_INTERVAL_MS).unref();
    }

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

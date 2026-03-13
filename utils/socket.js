import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { verifyAccessToken } from "../utils/token.js";
import { User } from "../models/User.js";
import { ChatGroup } from "../models/ChatGroup.js";
import { getRedisClients } from "../utils/redis.js";

/**
 * Initialises Socket.IO on top of an existing HTTP server.
 * Uses Redis adapter for Pub/Sub so it scales across multiple server instances.
 *
 * @param {import("http").Server} httpServer
 * @param {import("express").Application} app
 */
export function initSocketIO(httpServer, app) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Attach Redis Pub/Sub adapter for horizontal scaling
  try {
    const { pubClient, subClient } = getRedisClients();
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[Socket.IO] Redis adapter attached");
  } catch (err) {
    console.warn("[Socket.IO] Redis adapter failed, running in single-node mode:", err.message);
  }

  // Store io instance on the express app so controllers can access it via req.app.get("io")
  app.set("io", io);

  // Track online users: userId -> Set<socketId>
  const onlineUsers = new Map();

  // ── Authentication Middleware ────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).lean();
      if (!user || !user.isActive) {
        return next(new Error("Invalid user session"));
      }

      socket.userId = String(user._id);
      socket.userRole = user.role;
      next();
    } catch (err) {
      next(new Error("Authentication failed"));
    }
  });

  // ── Connection Handler ──────────────────────────────────────────────
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    console.log(`[Socket.IO] User connected: ${userId} (socket ${socket.id})`);

    // Join personal room
    socket.join(`user_${userId}`);

    // Auto-join all group rooms the user belongs to
    try {
      const groups = await ChatGroup.find({ members: userId, isActive: true })
        .select("_id")
        .lean();
      for (const g of groups) {
        socket.join(`group_${g._id}`);
      }
      console.log(`[Socket.IO] User ${userId} joined ${groups.length} group rooms`);
    } catch (err) {
      console.error(`[Socket.IO] Failed to join group rooms for ${userId}:`, err.message);
    }

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Broadcast online status
    io.emit("user_online", { userId });

    // ── Typing indicators (group-based) ─────────────────────────────
    socket.on("typing", ({ groupId }) => {
      socket.to(`group_${groupId}`).emit("typing", {
        groupId,
        userId,
      });
    });

    socket.on("stop_typing", ({ groupId }) => {
      socket.to(`group_${groupId}`).emit("stop_typing", {
        groupId,
        userId,
      });
    });

    // ── Join a new group room (when added to group at runtime) ──────
    socket.on("join_group", ({ groupId }) => {
      socket.join(`group_${groupId}`);
      console.log(`[Socket.IO] User ${userId} joined group_${groupId}`);
    });

    // ── Leave group room ────────────────────────────────────────────
    socket.on("leave_group", ({ groupId }) => {
      socket.leave(`group_${groupId}`);
      console.log(`[Socket.IO] User ${userId} left group_${groupId}`);
    });

    // ── Disconnect ──────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[Socket.IO] User disconnected: ${userId} (socket ${socket.id})`);
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          io.emit("user_offline", { userId });
        }
      }
    });
  });

  return io;
}

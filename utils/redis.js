import Redis from "ioredis";

let pubClient = null;
let subClient = null;

/**
 * Creates and returns a pair of Redis clients for Pub/Sub.
 * Re-uses existing connections if already created.
 */
export function getRedisClients() {
  if (pubClient && subClient) {
    return { pubClient, subClient };
  }

  const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

  pubClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      console.log(`[Redis] Pub client reconnecting in ${delay}ms (attempt ${times})`);
      return delay;
    },
  });

  subClient = pubClient.duplicate();

  pubClient.on("connect", () => console.log("[Redis] Pub client connected"));
  pubClient.on("error", (err) => console.error("[Redis] Pub client error:", err.message));

  subClient.on("connect", () => console.log("[Redis] Sub client connected"));
  subClient.on("error", (err) => console.error("[Redis] Sub client error:", err.message));

  return { pubClient, subClient };
}

/**
 * Publish a message to a Redis channel.
 * Used by controllers to broadcast events across multiple server instances.
 *
 * @param {string} channel  – Redis channel name (e.g. "chat:group:<groupId>")
 * @param {object} payload  – Data to publish (will be JSON-serialized)
 */
export async function publishEvent(channel, payload) {
  try {
    const { pubClient: pub } = getRedisClients();
    await pub.publish(channel, JSON.stringify(payload));
  } catch (err) {
    console.error(`[Redis] Failed to publish to ${channel}:`, err.message);
  }
}

/**
 * Gracefully disconnect Redis clients.
 */
export async function disconnectRedis() {
  if (pubClient) await pubClient.quit().catch(() => {});
  if (subClient) await subClient.quit().catch(() => {});
  pubClient = null;
  subClient = null;
  console.log("[Redis] Disconnected");
}

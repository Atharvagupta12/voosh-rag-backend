// Chat history per session. Redis when REDIS_URL is set, otherwise in-memory.
// Every write refreshes a sliding TTL, so idle sessions expire on their own.
import Redis from "ioredis";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("sessions");
const { ttlSeconds, maxMessages } = config.session;

function parse(item) {
  try {
    return JSON.parse(item);
  } catch {
    return null;
  }
}

function createRedisStore(url) {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  });

  let lastErrorLog = 0;
  redis.on("error", (err) => {
    if (Date.now() - lastErrorLog > 30_000) {
      log.warn(`Redis error: ${err.message}`);
      lastErrorLog = Date.now();
    }
  });
  redis.on("ready", () => log.info("Connected to Redis"));

  const key = (id) => `session:${id}:messages`;

  return {
    kind: "redis",

    async append(id, messages) {
      const k = key(id);
      const results = await redis
        .multi()
        .rpush(k, ...messages.map((m) => JSON.stringify(m)))
        .ltrim(k, -maxMessages, -1)
        .expire(k, ttlSeconds)
        .exec();
      const failed = results?.find(([err]) => err);
      if (failed) throw failed[0];
    },

    async history(id) {
      const k = key(id);
      const items = await redis.lrange(k, 0, -1);
      if (items.length) await redis.expire(k, ttlSeconds);
      return items.map(parse).filter(Boolean);
    },

    async ttl(id) {
      const t = await redis.ttl(key(id));
      return t > 0 ? t : null;
    },

    async clear(id) {
      await redis.del(key(id));
    },

    async ping() {
      return (await redis.ping()) === "PONG";
    },

    async close() {
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}

function createMemoryStore() {
  const sessions = new Map(); // id -> { messages, expiresAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (s.expiresAt <= now) sessions.delete(id);
  }, 60_000);
  sweep.unref();

  const live = (id) => {
    const s = sessions.get(id);
    if (s && s.expiresAt <= Date.now()) {
      sessions.delete(id);
      return null;
    }
    return s ?? null;
  };

  return {
    kind: "memory",

    async append(id, messages) {
      const s = live(id) ?? { messages: [] };
      s.messages.push(...structuredClone(messages));
      if (s.messages.length > maxMessages) s.messages.splice(0, s.messages.length - maxMessages);
      s.expiresAt = Date.now() + ttlSeconds * 1000;
      sessions.set(id, s);
    },

    async history(id) {
      const s = live(id);
      if (!s) return [];
      s.expiresAt = Date.now() + ttlSeconds * 1000;
      return structuredClone(s.messages);
    },

    async ttl(id) {
      const s = live(id);
      return s ? Math.round((s.expiresAt - Date.now()) / 1000) : null;
    },

    async clear(id) {
      sessions.delete(id);
    },

    async ping() {
      return true;
    },

    async close() {
      clearInterval(sweep);
    },
  };
}

export const sessionStore = config.redisUrl ? createRedisStore(config.redisUrl) : createMemoryStore();

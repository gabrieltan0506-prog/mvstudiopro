import type { Request, Response, NextFunction } from "express";

/**
 * 简易内存 Rate Limiter
 * 
 * 基于滑动窗口算法，按 IP 地址限制请求频率。
 * 适用於单实例部署；多实例需改用 Redis。
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// 每 5 分钟清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 60_000);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 300_000);

interface RateLimitOptions {
  windowMs: number;    // 时间窗口（毫秒）
  maxRequests: number; // 窗口内最大请求数
  keyPrefix?: string;  // 键前缀（区分不同限制器）
}

/**
 * 创建 Rate Limit 中间件
 */
export function createRateLimit(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyPrefix = "rl" } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    // 移除窗口外的记录
    entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

    if (entry.timestamps.length >= maxRequests) {
      const retryAfter = Math.ceil((entry.timestamps[0] + windowMs - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.set("X-RateLimit-Limit", String(maxRequests));
      res.set("X-RateLimit-Remaining", "0");
      res.set("X-RateLimit-Reset", String(Math.ceil((entry.timestamps[0] + windowMs) / 1000)));
      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        retryAfter,
      });
      return;
    }

    entry.timestamps.push(now);

    // 设置 Rate Limit headers
    res.set("X-RateLimit-Limit", String(maxRequests));
    res.set("X-RateLimit-Remaining", String(maxRequests - entry.timestamps.length));
    res.set("X-RateLimit-Reset", String(Math.ceil((now + windowMs) / 1000)));

    next();
  };
}

// ─── 缺省限制器 ─────────────────────────────────────

/** 通用 API 限制：每分钟 60 次 */
export const generalApiLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 60,
  keyPrefix: "api",
});

/** Stripe Checkout 限制：每分钟 5 次（防止重复下单） */
export const checkoutLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 5,
  keyPrefix: "checkout",
});

/** Webhook 限制：每分钟 100 次（Stripe 可能批量发送） */
export const webhookLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 100,
  keyPrefix: "webhook",
});

/** Auth 限制：每分钟 10 次（防止暴力破解） */
export const authLimit = createRateLimit({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: "auth",
});

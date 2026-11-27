import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { CacheService } from '../cache/cache.service';
import { MetricsService } from './metrics.service';

interface RateLimitBucket {
  name: string;
  limit: number;
  windowSec: number;
}

/**
 * Distributed Redis-Backed Rate Limiter Middleware (with graceful in-memory fallback).
 *
 * Enforces tiered per-user / per-IP quotas across high-cost AI & ingestion endpoints
 * so traffic bursts across 100M+ users never overwhelm LLM providers or GPU workers.
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RateLimitMiddleware.name);
  private readonly enabled: boolean;
  private readonly chatRpm: number;
  private readonly ingestRpm: number;
  private readonly studioRpm: number;
  private readonly globalRpm: number;
  private readonly memoryFallback = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly cache: CacheService,
    private readonly metrics: MetricsService,
  ) {
    this.enabled =
      (this.configService.get<string>('RATE_LIMIT_ENABLED', 'true') || 'true').toLowerCase() !== 'false';
    this.chatRpm = Number(this.configService.get<string>('RATE_LIMIT_CHAT_RPM', '60'));
    this.ingestRpm = Number(this.configService.get<string>('RATE_LIMIT_INGEST_RPM', '30'));
    this.studioRpm = Number(this.configService.get<string>('RATE_LIMIT_STUDIO_RPM', '20'));
    this.globalRpm = Number(this.configService.get<string>('RATE_LIMIT_GLOBAL_RPM', '300'));
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!this.enabled) {
      return next();
    }

    const path = req.originalUrl || req.url || '';
    if (path.startsWith('/healthz') || path.startsWith('/readyz') || path.startsWith('/metrics')) {
      return next();
    }

    const bucket = this.resolveBucket(path, req.method);
    const subject = this.resolveSubject(req);
    const result = await this.consumeToken(bucket, subject);

    res.setHeader('X-RateLimit-Limit', String(bucket.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, bucket.limit - result.count)));
    res.setHeader('X-RateLimit-Reset', String(result.resetEpochSec));

    if (!result.allowed) {
      this.metrics.incCounter('studygai_rate_limit_blocked_total', { bucket: bucket.name });
      res.setHeader('Retry-After', String(result.retryAfterSec));
      res.status(429).json({
        success: false,
        statusCode: 429,
        message: `Rate limit exceeded for ${bucket.name}. Please retry in ${result.retryAfterSec}s.`,
      });
      return;
    }

    next();
  }

  resolveBucket(path: string, method: string): RateLimitBucket {
    const m = (method || 'GET').toUpperCase();
    if (m === 'POST' && (path.includes('/chat/send') || path.includes('/send-message'))) {
      return { name: 'rag_chat', limit: this.chatRpm, windowSec: 60 };
    }
    if (m === 'POST' && (path.includes('/sources/') || path.includes('/upload/doc'))) {
      return { name: 'ingestion', limit: this.ingestRpm, windowSec: 60 };
    }
    if (m === 'POST' && (path.includes('/studio/') || path.includes('/quiz/generate') || path.includes('/generate-from-pdf'))) {
      return { name: 'studio_ai', limit: this.studioRpm, windowSec: 60 };
    }
    return { name: 'api_global', limit: this.globalRpm, windowSec: 60 };
  }

  /** Exposed for automated tests */
  async consumeToken(
    bucket: RateLimitBucket,
    subject: string,
  ): Promise<{ allowed: boolean; count: number; retryAfterSec: number; resetEpochSec: number }> {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowId = Math.floor(nowSec / bucket.windowSec);
    const resetEpochSec = (windowId + 1) * bucket.windowSec;
    const retryAfterSec = Math.max(1, resetEpochSec - nowSec);
    const key = `rl:${bucket.name}:${subject}:${windowId}`;

    const redis = this.cache.getClient();
    if (redis && redis.status === 'ready') {
      try {
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.expire(key, bucket.windowSec + 5);
        }
        return {
          allowed: count <= bucket.limit,
          count,
          retryAfterSec,
          resetEpochSec,
        };
      } catch (err: any) {
        this.logger.debug(`Redis rate limit fallback (${err.message})`);
      }
    }

    // Graceful in-memory fallback when Redis is unavailable
    const nowMs = Date.now();
    const existing = this.memoryFallback.get(key);
    if (!existing || existing.resetAt <= nowMs) {
      const entry = { count: 1, resetAt: resetEpochSec * 1000 };
      this.memoryFallback.set(key, entry);
      // Bound map memory in long-running dev instances
      if (this.memoryFallback.size > 50_000) {
        this.memoryFallback.clear();
      }
      return { allowed: true, count: 1, retryAfterSec, resetEpochSec };
    }

    existing.count += 1;
    return {
      allowed: existing.count <= bucket.limit,
      count: existing.count,
      retryAfterSec,
      resetEpochSec,
    };
  }

  private resolveSubject(req: Request): string {
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Lightweight JWT payload sub/id extraction without re-verifying signature in middleware
      const parts = authHeader.slice(7).split('.');
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          if (payload?.id) return `u:${payload.id}`;
        } catch {
          // Fall through to IP
        }
      }
    }
    const forwarded = req.headers?.['x-forwarded-for'];
    const ip =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]?.trim()) ||
      req.ip ||
      'unknown';
    return `ip:${ip}`;
  }
}

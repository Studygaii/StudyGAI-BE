import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL', 'redis://localhost:6379');
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));
    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.connect().catch((err) => {
      this.logger.error(`Redis connect failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  async ping(): Promise<boolean> {
    if (!this.client || this.client.status !== 'ready') return false;
    try {
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  async get<T = any>(key: string): Promise<T | null> {
    if (!this.client) return null;
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as any;
    }
  }

  async set(key: string, value: any, ttlSeconds = 300) {
    if (!this.client) return;
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds > 0) {
      await this.client.set(key, payload, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, payload);
    }
  }

  async del(key: string | string[]) {
    if (!this.client) return;
    if (Array.isArray(key)) {
      await this.client.del(...key);
    } else {
      await this.client.del(key);
    }
  }
}


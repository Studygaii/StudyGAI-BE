import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import Redis from 'ioredis';

/**
 * Horizontal Multi-Replica Socket.IO Adapter backed by Redis Pub/Sub.
 *
 * Enables hundreds of stateless NestJS pods behind a load balancer to broadcast
 * `@studygai` group chat messages, live quiz leaderboards, and document ingestion
 * `source-status` updates seamlessly across rooms.
 *
 * Gracefully falls back to standard single-node IoAdapter if Redis is unavailable
 * or `ENABLE_REDIS_WS_ADAPTER=false`.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: any = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(redisUrl?: string): Promise<boolean> {
    const enabled = (process.env.ENABLE_REDIS_WS_ADAPTER || 'true').toLowerCase() !== 'false';
    if (!enabled) {
      this.logger.log('Redis WebSocket adapter disabled via ENABLE_REDIS_WS_ADAPTER=false');
      return false;
    }

    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      // Load @socket.io/redis-adapter dynamically so single-node builds stay resilient
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createAdapter } = require('@socket.io/redis-adapter');

      this.pubClient = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
      this.subClient = this.pubClient.duplicate();

      this.pubClient.on('error', (err) => this.logger.debug(`WS Redis pub warning: ${err.message}`));
      this.subClient.on('error', (err) => this.logger.debug(`WS Redis sub warning: ${err.message}`));

      await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
      this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
      this.logger.log(`Socket.IO Redis Adapter connected (${url}) — multi-replica WebSockets active`);
      return true;
    } catch (err: any) {
      this.logger.warn(
        `Socket.IO Redis Adapter unavailable (${err.message}); falling back to single-node adapter`,
      );
      await this.close().catch(() => undefined);
      return false;
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  async close(): Promise<void> {
    await this.pubClient?.quit().catch(() => undefined);
    await this.subClient?.quit().catch(() => undefined);
    this.pubClient = null;
    this.subClient = null;
  }
}

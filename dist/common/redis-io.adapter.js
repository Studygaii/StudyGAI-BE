"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisIoAdapter = void 0;
const common_1 = require("@nestjs/common");
const platform_socket_io_1 = require("@nestjs/platform-socket.io");
const ioredis_1 = __importDefault(require("ioredis"));
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
class RedisIoAdapter extends platform_socket_io_1.IoAdapter {
    constructor(app) {
        super(app);
        this.logger = new common_1.Logger(RedisIoAdapter.name);
        this.adapterConstructor = null;
        this.pubClient = null;
        this.subClient = null;
    }
    async connectToRedis(redisUrl) {
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
            this.pubClient = new ioredis_1.default(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
            this.subClient = this.pubClient.duplicate();
            this.pubClient.on('error', (err) => this.logger.debug(`WS Redis pub warning: ${err.message}`));
            this.subClient.on('error', (err) => this.logger.debug(`WS Redis sub warning: ${err.message}`));
            await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
            this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
            this.logger.log(`Socket.IO Redis Adapter connected (${url}) — multi-replica WebSockets active`);
            return true;
        }
        catch (err) {
            this.logger.warn(`Socket.IO Redis Adapter unavailable (${err.message}); falling back to single-node adapter`);
            await this.close().catch(() => undefined);
            return false;
        }
    }
    createIOServer(port, options) {
        const server = super.createIOServer(port, options);
        if (this.adapterConstructor) {
            server.adapter(this.adapterConstructor);
        }
        return server;
    }
    async close() {
        await this.pubClient?.quit().catch(() => undefined);
        await this.subClient?.quit().catch(() => undefined);
        this.pubClient = null;
        this.subClient = null;
    }
}
exports.RedisIoAdapter = RedisIoAdapter;
//# sourceMappingURL=redis-io.adapter.js.map
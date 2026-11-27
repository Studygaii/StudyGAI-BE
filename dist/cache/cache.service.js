"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var CacheService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ioredis_1 = __importDefault(require("ioredis"));
let CacheService = CacheService_1 = class CacheService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(CacheService_1.name);
        this.client = null;
    }
    onModuleInit() {
        const url = this.configService.get('REDIS_URL', 'redis://localhost:6379');
        this.client = new ioredis_1.default(url, {
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
    getClient() {
        return this.client;
    }
    async ping() {
        if (!this.client || this.client.status !== 'ready')
            return false;
        try {
            const pong = await this.client.ping();
            return pong === 'PONG';
        }
        catch {
            return false;
        }
    }
    async get(key) {
        if (!this.client)
            return null;
        const raw = await this.client.get(key);
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            return raw;
        }
    }
    async set(key, value, ttlSeconds = 300) {
        if (!this.client)
            return;
        const payload = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttlSeconds > 0) {
            await this.client.set(key, payload, 'EX', ttlSeconds);
        }
        else {
            await this.client.set(key, payload);
        }
    }
    async del(key) {
        if (!this.client)
            return;
        if (Array.isArray(key)) {
            await this.client.del(...key);
        }
        else {
            await this.client.del(key);
        }
    }
};
exports.CacheService = CacheService;
exports.CacheService = CacheService = CacheService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], CacheService);
//# sourceMappingURL=cache.service.js.map
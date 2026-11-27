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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpsController = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const swagger_1 = require("@nestjs/swagger");
const mongoose_2 = require("mongoose");
const axios_1 = __importDefault(require("axios"));
const cache_service_1 = require("../cache/cache.service");
const qdrant_service_1 = require("../qdrant/qdrant.service");
const storage_service_1 = require("../storage/storage.service");
const vector_tiering_service_1 = require("../rag/vector-tiering.service");
const metrics_service_1 = require("./metrics.service");
let OpsController = class OpsController {
    constructor(configService, mongoConnection, cache, qdrant, storage, tiering, metrics) {
        this.configService = configService;
        this.mongoConnection = mongoConnection;
        this.cache = cache;
        this.qdrant = qdrant;
        this.storage = storage;
        this.tiering = tiering;
        this.metrics = metrics;
        this.workerUrl = (this.configService.get('RAG_WORKER_URL') ||
            this.configService.get('DOCLING_SERVICE_URL') ||
            'http://localhost:5000').replace(/\/$/, '');
    }
    /** Kubernetes Liveness Probe (fast, zero external I/O) */
    liveness() {
        return { status: 'ok', timestamp: new Date().toISOString() };
    }
    /** Kubernetes Readiness Probe (checks MongoDB, Redis, Qdrant, Storage, and RAG Worker) */
    async readiness(res) {
        const mongoReady = this.mongoConnection.readyState === 1;
        const [redisReady, qdrantReady, workerReady] = await Promise.all([
            this.cache.ping().catch(() => false),
            this.qdrant.health().catch(() => false),
            axios_1.default
                .get(`${this.workerUrl}/health`, { timeout: 2500 })
                .then((r) => r.status === 200)
                .catch(() => false),
        ]);
        const coreReady = mongoReady;
        const payload = {
            status: coreReady ? (qdrantReady && redisReady ? 'ready' : 'degraded') : 'not_ready',
            dependencies: {
                mongodb: mongoReady ? 'up' : 'down',
                redis: redisReady ? 'up' : 'down',
                qdrant: qdrantReady ? 'up' : 'down',
                ragWorker: workerReady ? 'up' : 'down',
                storageDriver: this.storage.getDriver(),
            },
            timestamp: new Date().toISOString(),
        };
        return res.status(coreReady ? common_1.HttpStatus.OK : common_1.HttpStatus.SERVICE_UNAVAILABLE).json(payload);
    }
    /** Prometheus OpenMetrics 0.0.4 scrape endpoint */
    scrapeMetrics(req) {
        const requiredToken = this.configService.get('METRICS_BEARER_TOKEN');
        if (requiredToken) {
            const auth = req.headers?.authorization || '';
            if (auth !== `Bearer ${requiredToken}`) {
                throw new common_1.ForbiddenException('Invalid metrics token');
            }
        }
        return this.metrics.renderPrometheus();
    }
    /** Hot/Cold Qdrant vector tiering statistics */
    async tieringStats(req) {
        this.assertOpsAdmin(req);
        const stats = await this.tiering.getTieringStats();
        return { success: true, data: stats };
    }
    /** Trigger Hot -> Cold Qdrant vector archival (invoked by Kubernetes CronJob) */
    async triggerArchive(inactiveDays = '30', limit = '100', req) {
        this.assertOpsAdmin(req);
        const days = Math.max(1, Number(inactiveDays) || 30);
        const maxBatch = Math.min(500, Math.max(1, Number(limit) || 100));
        const result = await this.tiering.archiveColdBlobs(days, maxBatch);
        return { success: true, data: result };
    }
    assertOpsAdmin(req) {
        const adminToken = this.configService.get('OPS_ADMIN_TOKEN');
        if (!adminToken)
            return; // Allow local dev if token unset
        const header = req.headers?.['x-ops-token'] || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
        if (header !== adminToken) {
            throw new common_1.ForbiddenException('Invalid X-Ops-Token');
        }
    }
};
exports.OpsController = OpsController;
__decorate([
    (0, common_1.Get)('healthz'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({ summary: 'Kubernetes liveness probe' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], OpsController.prototype, "liveness", null);
__decorate([
    (0, common_1.Get)('readyz'),
    (0, swagger_1.ApiOperation)({ summary: 'Kubernetes readiness probe verifying core dependencies' }),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "readiness", null);
__decorate([
    (0, common_1.Get)('metrics'),
    (0, common_1.Header)('Content-Type', 'text/plain; version=0.0.4; charset=utf-8'),
    (0, swagger_1.ApiOperation)({ summary: 'Prometheus metrics exposition endpoint' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", String)
], OpsController.prototype, "scrapeMetrics", null);
__decorate([
    (0, common_1.Get)('api/v1/ops/tiering/stats'),
    (0, swagger_1.ApiOperation)({ summary: 'Get Hot/Cold Qdrant vector tiering stats and estimated RAM saved' }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "tieringStats", null);
__decorate([
    (0, common_1.Post)('api/v1/ops/tiering/archive'),
    (0, swagger_1.ApiOperation)({ summary: 'Archive inactive hot Qdrant blobs to S3/R2 cold snapshots' }),
    __param(0, (0, common_1.Query)('inactiveDays')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], OpsController.prototype, "triggerArchive", null);
exports.OpsController = OpsController = __decorate([
    (0, swagger_1.ApiTags)('Operations & Observability'),
    (0, common_1.Controller)(),
    __param(1, (0, mongoose_1.InjectConnection)()),
    __metadata("design:paramtypes", [config_1.ConfigService,
        mongoose_2.Connection,
        cache_service_1.CacheService,
        qdrant_service_1.QdrantService,
        storage_service_1.StorageService,
        vector_tiering_service_1.VectorTieringService,
        metrics_service_1.MetricsService])
], OpsController);
//# sourceMappingURL=ops.controller.js.map
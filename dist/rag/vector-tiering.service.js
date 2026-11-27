"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var VectorTieringService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.VectorTieringService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const zlib = __importStar(require("zlib"));
const storage_service_1 = require("../storage/storage.service");
const qdrant_service_1 = require("../qdrant/qdrant.service");
const chunker_service_1 = require("./chunker.service");
const metrics_service_1 = require("../ops/metrics.service");
/**
 * Hot / Warm / Cold Qdrant Vector Tiering Engine for 100M+ Users.
 *
 * Cuts active vector cluster RAM/NVMe cost by 5-10x:
 * - Archive (Hot -> Cold): Exports vectors for blobs untouched for >N days, gzips them
 *   into JSONL snapshots in S3/R2/MinIO (`blobs/vectors/...jsonl.gz`), and evicts them from Qdrant.
 * - Re-Hydrate (Cold -> Hot): Transparently restores archived vectors back into Qdrant on demand
 *   when a user re-opens an old notebook, protected by an in-flight lock to prevent thundering herds.
 */
let VectorTieringService = VectorTieringService_1 = class VectorTieringService {
    constructor(configService, storage, qdrant, chunker, metrics, blobModel, parentChunkModel) {
        this.configService = configService;
        this.storage = storage;
        this.qdrant = qdrant;
        this.chunker = chunker;
        this.metrics = metrics;
        this.blobModel = blobModel;
        this.parentChunkModel = parentChunkModel;
        this.logger = new common_1.Logger(VectorTieringService_1.name);
        this.rehydratingLocks = new Map();
        this.archivalTimer = null;
    }
    onModuleInit() {
        const cronEnabled = (this.configService.get('ENABLE_VECTOR_TIERING_CRON', 'false') || 'false').toLowerCase() === 'true';
        if (!cronEnabled)
            return;
        const intervalHours = Math.max(1, Number(this.configService.get('VECTOR_TIERING_INTERVAL_HOURS', '6')));
        const inactiveDays = Math.max(1, Number(this.configService.get('VECTOR_COLD_AFTER_DAYS', '30')));
        this.archivalTimer = setInterval(() => {
            this.archiveColdBlobs(inactiveDays, 100).catch((err) => {
                this.logger.warn(`Scheduled vector archival warning: ${err.message}`);
            });
        }, intervalHours * 3600 * 1000);
        this.logger.log(`Vector tiering cron enabled: archive blobs idle >${inactiveDays}d every ${intervalHours}h`);
    }
    onModuleDestroy() {
        if (this.archivalTimer) {
            clearInterval(this.archivalTimer);
            this.archivalTimer = null;
        }
    }
    /** Serialize points to compressed gzipped JSONL buffer (compact & streaming-friendly) */
    encodeSnapshot(points) {
        const jsonl = points.map((p) => JSON.stringify(p)).join('\n');
        return zlib.gzipSync(Buffer.from(jsonl, 'utf8'));
    }
    /** Decode gzipped JSONL snapshot back into Qdrant points */
    decodeSnapshot(gzBuffer) {
        const raw = zlib.gunzipSync(gzBuffer).toString('utf8').trim();
        if (!raw)
            return [];
        return raw
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    /**
     * Archive inactive hot blobs from Qdrant into cheap S3/R2/MinIO cold storage.
     */
    async archiveColdBlobs(inactiveDays = 30, batchLimit = 100) {
        const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
        const candidates = await this.blobModel
            .find({
            status: 'ready',
            vectorTier: 'hot',
            lastAccessedAt: { $lt: cutoff },
        })
            .sort({ lastAccessedAt: 1 })
            .limit(batchLimit)
            .exec();
        let archived = 0;
        let skipped = 0;
        let evictedPoints = 0;
        for (const blob of candidates) {
            const blobId = blob._id.toString();
            try {
                const points = await this.qdrant.exportBlobPoints(blobId, blob.vectorCollection || undefined);
                if (points.length === 0) {
                    skipped++;
                    continue;
                }
                const archiveKey = this.storage.buildBlobKey(blob.sha256, 'vectors');
                const gz = this.encodeSnapshot(points);
                await this.storage.putObject(archiveKey, gz, 'application/gzip');
                await this.qdrant.deleteBlobChunks(blobId, blob.vectorCollection || undefined);
                blob.vectorTier = 'cold';
                blob.vectorArchiveKey = archiveKey;
                await blob.save();
                archived++;
                evictedPoints += points.length;
                this.metrics.incCounter('studygai_vector_tiering_events_total', { action: 'archived' });
            }
            catch (err) {
                this.logger.warn(`Cold archive skipped for blob=${blobId}: ${err.message}`);
                skipped++;
            }
        }
        if (archived > 0) {
            this.logger.log(`Cold archival complete: archived=${archived}/${candidates.length} blobs, evicted=${evictedPoints} Qdrant points`);
        }
        return { scanned: candidates.length, archived, skipped, evictedPoints };
    }
    /**
     * Ensure all requested blobs are in the Hot Qdrant tier before running hybrid search.
     * Transparently re-hydrates any Cold blobs with in-flight thundering-herd protection.
     */
    async ensureBlobsHot(blobIds) {
        const validIds = (blobIds || []).filter((id) => mongoose_2.Types.ObjectId.isValid(id));
        if (validIds.length === 0)
            return { rehydratedCount: 0 };
        const coldBlobs = await this.blobModel
            .find({
            _id: { $in: validIds.map((id) => new mongoose_2.Types.ObjectId(id)) },
            vectorTier: 'cold',
        })
            .exec();
        if (coldBlobs.length === 0)
            return { rehydratedCount: 0 };
        await Promise.all(coldBlobs.map((blob) => this.rehydrateBlobWithLock(blob)));
        return { rehydratedCount: coldBlobs.length };
    }
    async getTieringStats() {
        const agg = await this.blobModel.aggregate([
            { $match: { status: 'ready' } },
            {
                $group: {
                    _id: '$vectorTier',
                    blobs: { $sum: 1 },
                    chunks: { $sum: '$chunkCount' },
                    tokens: { $sum: '$tokenEstimate' },
                },
            },
        ]);
        const hot = agg.find((a) => a._id === 'hot') || { blobs: 0, chunks: 0, tokens: 0 };
        const cold = agg.find((a) => a._id === 'cold') || { blobs: 0, chunks: 0, tokens: 0 };
        // Estimate INT8 vector footprint (~1.5KB/chunk including HNSW links)
        const estimatedHotRamMB = Number(((hot.chunks * 1536) / (1024 * 1024)).toFixed(2));
        const estimatedSavedRamMB = Number(((cold.chunks * 1536) / (1024 * 1024)).toFixed(2));
        return {
            hot: { blobs: hot.blobs, chunks: hot.chunks, tokens: hot.tokens, estimatedRamMB: estimatedHotRamMB },
            cold: { blobs: cold.blobs, chunks: cold.chunks, tokens: cold.tokens, estimatedSavedRamMB },
        };
    }
    async rehydrateBlobWithLock(blob) {
        const blobId = blob._id.toString();
        const inFlight = this.rehydratingLocks.get(blobId);
        if (inFlight) {
            return inFlight;
        }
        const promise = this.rehydrateSingleBlob(blob).finally(() => {
            this.rehydratingLocks.delete(blobId);
        });
        this.rehydratingLocks.set(blobId, promise);
        return promise;
    }
    async rehydrateSingleBlob(blob) {
        const blobId = blob._id.toString();
        const startMs = Date.now();
        let restoredPoints = 0;
        if (blob.vectorArchiveKey && (await this.storage.exists(blob.vectorArchiveKey))) {
            const gz = await this.storage.getObjectBuffer(blob.vectorArchiveKey);
            const points = this.decodeSnapshot(gz);
            restoredPoints = await this.qdrant.restoreBlobPoints(blobId, points, blob.vectorCollection || undefined);
        }
        else {
            // Fallback: reconstruct sparse vectors from persisted ParentChunks if snapshot missing
            const parents = await this.parentChunkModel
                .find({ blob: blob._id })
                .sort({ parentIndex: 1 })
                .lean();
            const combined = parents.map((p) => p.text).join('\n\n');
            if (combined) {
                const chunked = this.chunker.buildParentChildChunks(combined, blobId, blob.originalName || 'Source');
                const res = await this.qdrant.upsertChildChunksFallback({
                    children: chunked.children,
                    blobId,
                    sourceName: blob.originalName || 'Source',
                    sourceType: blob.sourceType,
                    collectionName: blob.vectorCollection || undefined,
                });
                restoredPoints = res.chunksStored;
            }
        }
        blob.vectorTier = 'hot';
        blob.lastAccessedAt = new Date();
        await blob.save();
        this.metrics.incCounter('studygai_vector_tiering_events_total', { action: 'rehydrated' });
        this.logger.log(`Re-hydrated cold blob=${blobId} (${restoredPoints} points) in ${Date.now() - startMs}ms`);
    }
};
exports.VectorTieringService = VectorTieringService;
exports.VectorTieringService = VectorTieringService = VectorTieringService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(5, (0, mongoose_1.InjectModel)('source_blobs')),
    __param(6, (0, mongoose_1.InjectModel)('parent_chunks')),
    __metadata("design:paramtypes", [config_1.ConfigService,
        storage_service_1.StorageService,
        qdrant_service_1.QdrantService,
        chunker_service_1.ChunkerService,
        metrics_service_1.MetricsService,
        mongoose_2.Model,
        mongoose_2.Model])
], VectorTieringService);
//# sourceMappingURL=vector-tiering.service.js.map
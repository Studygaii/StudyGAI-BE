import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as zlib from 'zlib';
import { SourceBlobDocument } from '../schemas/source-blob.schema';
import { ParentChunkDocument } from '../schemas/parent-chunk.schema';
import { StorageService } from '../storage/storage.service';
import { ExportedQdrantPoint, QdrantService } from '../qdrant/qdrant.service';
import { ChunkerService } from './chunker.service';
import { MetricsService } from '../ops/metrics.service';

/**
 * Hot / Warm / Cold Qdrant Vector Tiering Engine for 100M+ Users.
 *
 * Cuts active vector cluster RAM/NVMe cost by 5-10x:
 * - Archive (Hot -> Cold): Exports vectors for blobs untouched for >N days, gzips them
 *   into JSONL snapshots in S3/R2/MinIO (`blobs/vectors/...jsonl.gz`), and evicts them from Qdrant.
 * - Re-Hydrate (Cold -> Hot): Transparently restores archived vectors back into Qdrant on demand
 *   when a user re-opens an old notebook, protected by an in-flight lock to prevent thundering herds.
 */
@Injectable()
export class VectorTieringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VectorTieringService.name);
  private readonly rehydratingLocks = new Map<string, Promise<void>>();
  private archivalTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly storage: StorageService,
    private readonly qdrant: QdrantService,
    private readonly chunker: ChunkerService,
    private readonly metrics: MetricsService,
    @InjectModel('source_blobs') private readonly blobModel: Model<SourceBlobDocument>,
    @InjectModel('parent_chunks') private readonly parentChunkModel: Model<ParentChunkDocument>,
  ) {}

  onModuleInit(): void {
    const cronEnabled =
      (this.configService.get<string>('ENABLE_VECTOR_TIERING_CRON', 'false') || 'false').toLowerCase() === 'true';
    if (!cronEnabled) return;

    const intervalHours = Math.max(
      1,
      Number(this.configService.get<string>('VECTOR_TIERING_INTERVAL_HOURS', '6')),
    );
    const inactiveDays = Math.max(
      1,
      Number(this.configService.get<string>('VECTOR_COLD_AFTER_DAYS', '30')),
    );

    this.archivalTimer = setInterval(() => {
      this.archiveColdBlobs(inactiveDays, 100).catch((err) => {
        this.logger.warn(`Scheduled vector archival warning: ${err.message}`);
      });
    }, intervalHours * 3600 * 1000);

    this.logger.log(
      `Vector tiering cron enabled: archive blobs idle >${inactiveDays}d every ${intervalHours}h`,
    );
  }

  onModuleDestroy(): void {
    if (this.archivalTimer) {
      clearInterval(this.archivalTimer);
      this.archivalTimer = null;
    }
  }

  /** Serialize points to compressed gzipped JSONL buffer (compact & streaming-friendly) */
  encodeSnapshot(points: ExportedQdrantPoint[]): Buffer {
    const jsonl = points.map((p) => JSON.stringify(p)).join('\n');
    return zlib.gzipSync(Buffer.from(jsonl, 'utf8'));
  }

  /** Decode gzipped JSONL snapshot back into Qdrant points */
  decodeSnapshot(gzBuffer: Buffer): ExportedQdrantPoint[] {
    const raw = zlib.gunzipSync(gzBuffer).toString('utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ExportedQdrantPoint);
  }

  /**
   * Archive inactive hot blobs from Qdrant into cheap S3/R2/MinIO cold storage.
   */
  async archiveColdBlobs(
    inactiveDays = 30,
    batchLimit = 100,
  ): Promise<{ scanned: number; archived: number; skipped: number; evictedPoints: number }> {
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
      } catch (err: any) {
        this.logger.warn(`Cold archive skipped for blob=${blobId}: ${err.message}`);
        skipped++;
      }
    }

    if (archived > 0) {
      this.logger.log(
        `Cold archival complete: archived=${archived}/${candidates.length} blobs, evicted=${evictedPoints} Qdrant points`,
      );
    }

    return { scanned: candidates.length, archived, skipped, evictedPoints };
  }

  /**
   * Ensure all requested blobs are in the Hot Qdrant tier before running hybrid search.
   * Transparently re-hydrates any Cold blobs with in-flight thundering-herd protection.
   */
  async ensureBlobsHot(blobIds: string[]): Promise<{ rehydratedCount: number }> {
    const validIds = (blobIds || []).filter((id) => Types.ObjectId.isValid(id));
    if (validIds.length === 0) return { rehydratedCount: 0 };

    const coldBlobs = await this.blobModel
      .find({
        _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
        vectorTier: 'cold',
      })
      .exec();

    if (coldBlobs.length === 0) return { rehydratedCount: 0 };

    await Promise.all(
      coldBlobs.map((blob) => this.rehydrateBlobWithLock(blob)),
    );

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

  private async rehydrateBlobWithLock(blob: SourceBlobDocument): Promise<void> {
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

  private async rehydrateSingleBlob(blob: SourceBlobDocument): Promise<void> {
    const blobId = blob._id.toString();
    const startMs = Date.now();
    let restoredPoints = 0;

    if (blob.vectorArchiveKey && (await this.storage.exists(blob.vectorArchiveKey))) {
      const gz = await this.storage.getObjectBuffer(blob.vectorArchiveKey);
      const points = this.decodeSnapshot(gz);
      restoredPoints = await this.qdrant.restoreBlobPoints(
        blobId,
        points,
        blob.vectorCollection || undefined,
      );
    } else {
      // Fallback: reconstruct sparse vectors from persisted ParentChunks if snapshot missing
      const parents = await this.parentChunkModel
        .find({ blob: blob._id })
        .sort({ parentIndex: 1 })
        .lean();
      const combined = parents.map((p: any) => p.text).join('\n\n');
      if (combined) {
        const chunked = this.chunker.buildParentChildChunks(
          combined,
          blobId,
          blob.originalName || 'Source',
        );
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
    this.logger.log(
      `Re-hydrated cold blob=${blobId} (${restoredPoints} points) in ${Date.now() - startMs}ms`,
    );
  }
}

import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Connection } from 'mongoose';
import { Response } from 'express';
import axios from 'axios';
import { CacheService } from '../cache/cache.service';
import { QdrantService } from '../qdrant/qdrant.service';
import { StorageService } from '../storage/storage.service';
import { VectorTieringService } from '../rag/vector-tiering.service';
import { MetricsService } from './metrics.service';

@ApiTags('Operations & Observability')
@Controller()
export class OpsController {
  private readonly workerUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly cache: CacheService,
    private readonly qdrant: QdrantService,
    private readonly storage: StorageService,
    private readonly tiering: VectorTieringService,
    private readonly metrics: MetricsService,
  ) {
    this.workerUrl = (
      this.configService.get<string>('RAG_WORKER_URL') ||
      this.configService.get<string>('DOCLING_SERVICE_URL') ||
      'http://localhost:5000'
    ).replace(/\/$/, '');
  }

  /** Kubernetes Liveness Probe (fast, zero external I/O) */
  @Get('healthz')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Kubernetes Readiness Probe (checks MongoDB, Redis, Qdrant, Storage, and RAG Worker) */
  @Get('readyz')
  @ApiOperation({ summary: 'Kubernetes readiness probe verifying core dependencies' })
  async readiness(@Res() res: Response) {
    const mongoReady = this.mongoConnection.readyState === 1;
    const [redisReady, qdrantReady, workerReady] = await Promise.all([
      this.cache.ping().catch(() => false),
      this.qdrant.health().catch(() => false),
      axios
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

    return res.status(coreReady ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(payload);
  }

  /** Prometheus OpenMetrics 0.0.4 scrape endpoint */
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics exposition endpoint' })
  scrapeMetrics(@Req() req: any): string {
    const requiredToken = this.configService.get<string>('METRICS_BEARER_TOKEN');
    if (requiredToken) {
      const auth = req.headers?.authorization || '';
      if (auth !== `Bearer ${requiredToken}`) {
        throw new ForbiddenException('Invalid metrics token');
      }
    }
    return this.metrics.renderPrometheus();
  }

  /** Hot/Cold Qdrant vector tiering statistics */
  @Get('api/v1/ops/tiering/stats')
  @ApiOperation({ summary: 'Get Hot/Cold Qdrant vector tiering stats and estimated RAM saved' })
  async tieringStats(@Req() req: any) {
    this.assertOpsAdmin(req);
    const stats = await this.tiering.getTieringStats();
    return { success: true, data: stats };
  }

  /** Trigger Hot -> Cold Qdrant vector archival (invoked by Kubernetes CronJob) */
  @Post('api/v1/ops/tiering/archive')
  @ApiOperation({ summary: 'Archive inactive hot Qdrant blobs to S3/R2 cold snapshots' })
  async triggerArchive(
    @Query('inactiveDays') inactiveDays = '30',
    @Query('limit') limit = '100',
    @Req() req: any,
  ) {
    this.assertOpsAdmin(req);
    const days = Math.max(1, Number(inactiveDays) || 30);
    const maxBatch = Math.min(500, Math.max(1, Number(limit) || 100));
    const result = await this.tiering.archiveColdBlobs(days, maxBatch);
    return { success: true, data: result };
  }

  private assertOpsAdmin(req: any): void {
    const adminToken = this.configService.get<string>('OPS_ADMIN_TOKEN');
    if (!adminToken) return; // Allow local dev if token unset
    const header = req.headers?.['x-ops-token'] || req.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (header !== adminToken) {
      throw new ForbiddenException('Invalid X-Ops-Token');
    }
  }
}

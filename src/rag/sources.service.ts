import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { SourceBlobDocument, SourceType } from '../schemas/source-blob.schema';
import { CourseSourceDocument } from '../schemas/course-source.schema';
import { ParentChunkDocument } from '../schemas/parent-chunk.schema';
import { CourseDocument } from '../schemas/course.schema';
import { StorageService } from '../storage/storage.service';
import { QdrantService } from '../qdrant/qdrant.service';
import { SourceAccessService } from './source-access.service';
import { IngestionProcessor } from './ingestion.processor';
import { IngestNoteDto, IngestUrlDto, PresignUploadDto } from './dto/ingest-source.dto';
import { MetricsService } from '../ops/metrics.service';

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly qdrant: QdrantService,
    private readonly sourceAccess: SourceAccessService,
    private readonly ingestion: IngestionProcessor,
    private readonly metrics: MetricsService,
    @InjectModel('source_blobs') private readonly blobModel: Model<SourceBlobDocument>,
    @InjectModel('course_sources') private readonly courseSourceModel: Model<CourseSourceDocument>,
    @InjectModel('parent_chunks') private readonly parentChunkModel: Model<ParentChunkDocument>,
    @InjectModel('courses') private readonly courseModel: Model<CourseDocument>,
  ) {}

  detectSourceType(fileName: string): SourceType {
    const ext = (path.extname(fileName) || '').toLowerCase();
    if (ext === '.pdf') return 'pdf';
    if (['.doc', '.docx', '.docm'].includes(ext)) return 'docx';
    if (['.ppt', '.pptx'].includes(ext)) return 'pptx';
    if (['.md', '.markdown'].includes(ext)) return 'markdown';
    if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return 'image';
    if (['.mp3', '.wav', '.m4a', '.ogg', '.webm'].includes(ext)) return 'audio';
    return 'txt';
  }

  isYoutubeUrl(url: string): boolean {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.includes('youtube.com') || host.includes('youtu.be');
    } catch {
      return false;
    }
  }

  /**
   * Multi-file upload handler with SHA-256 content-addressable deduplication.
   * Processes ALL uploaded files (fixing legacy bug where files[1..9] were silently ignored).
   */
  async ingestUploadedFiles(
    courseId: string,
    userId: string,
    files: Array<Express.Multer.File>,
    options: { sync?: boolean; mode?: 'auto' | 'accurate' } = {},
  ) {
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const results: any[] = [];

    for (const file of files) {
      const buffer = file.buffer ? file.buffer : await fs.promises.readFile(file.path);
      const sha256 = this.storage.sha256(buffer);
      const sourceType = this.detectSourceType(file.originalname);
      const ext = path.extname(file.originalname).toLowerCase();

      // Remove multer temp file once read into content-addressed storage
      if (file.path && fs.existsSync(file.path)) {
        await fs.promises.unlink(file.path).catch(() => undefined);
      }

      // 1. Check global deduplication table (instant 0ms onboarding across 100M users!)
      let blob = await this.blobModel.findOne({ sha256 }).exec();
      let deduplicated = false;

      if (blob && blob.status === 'ready') {
        deduplicated = true;
        this.metrics.incCounter('studygai_rag_cache_events_total', { layer: 'dedup_blob', outcome: 'hit' });
        await this.blobModel.findByIdAndUpdate(blob._id, {
          $inc: { refCount: 1 },
          $set: { lastAccessedAt: new Date() },
        });
      } else if (!blob) {
        this.metrics.incCounter('studygai_rag_cache_events_total', { layer: 'dedup_blob', outcome: 'miss' });
        const storageKey = this.storage.buildBlobKey(sha256, 'raw', ext);
        await this.storage.putObject(storageKey, buffer, file.mimetype || 'application/octet-stream');

        blob = await this.blobModel.create({
          sha256,
          sourceType,
          originalName: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          byteSize: buffer.length,
          storageKey,
          status: 'queued',
          refCount: 1,
        });
      } else {
        // Blob exists in failed/pending state — re-store raw file if missing & re-queue
        if (!blob.storageKey || !(await this.storage.exists(blob.storageKey))) {
          const storageKey = this.storage.buildBlobKey(sha256, 'raw', ext);
          await this.storage.putObject(storageKey, buffer, file.mimetype || 'application/octet-stream');
          blob.storageKey = storageKey;
        }
        blob.status = 'queued';
        blob.errorMessage = '';
        await blob.save();
      }

      // 2. Link blob to this Course (idempotent upsert)
      const courseSource = await this.upsertCourseSource({
        courseId,
        blobId: blob._id.toString(),
        userId,
        title: file.originalname,
        sourceType,
        status: deduplicated ? 'ready' : 'queued',
      });

      if (deduplicated) {
        await this.syncCourseReadyFlags(courseId, file.originalname, blob.pageCount, blob.charCount);
        results.push({
          sourceId: courseSource._id.toString(),
          blobId: blob._id.toString(),
          title: courseSource.title,
          sourceType,
          status: 'ready',
          deduplicated: true,
          pageCount: blob.pageCount,
          chunkCount: blob.chunkCount,
          tokenEstimate: blob.tokenEstimate,
        });
        continue;
      }

      // 3. Queue (or sync-process) ingestion
      const jobPayload = {
        kind: 'file' as const,
        blobId: blob._id.toString(),
        courseId,
        courseSourceId: courseSource._id.toString(),
        sourceName: file.originalname,
        sourceType,
        storageKey: blob.storageKey,
        mode: options.mode || 'auto',
      };

      if (options.sync) {
        await this.ingestion.processPayload(jobPayload);
        const updatedBlob = await this.blobModel.findById(blob._id).lean();
        results.push({
          sourceId: courseSource._id.toString(),
          blobId: blob._id.toString(),
          title: courseSource.title,
          sourceType,
          status: updatedBlob?.status || 'ready',
          deduplicated: false,
          pageCount: updatedBlob?.pageCount || 1,
          chunkCount: updatedBlob?.chunkCount || 0,
          tokenEstimate: updatedBlob?.tokenEstimate || 0,
        });
      } else {
        const priority = buffer.length < 2 * 1024 * 1024 ? 1 : 5;
        const job = await this.ingestion.enqueue(jobPayload, priority);
        results.push({
          sourceId: courseSource._id.toString(),
          blobId: blob._id.toString(),
          title: courseSource.title,
          sourceType,
          status: 'queued',
          deduplicated: false,
          jobId: job.jobId,
        });
      }
    }

    return {
      success: true,
      message: `${results.length} source(s) accepted`,
      data: { sources: results },
    };
  }

  /**
   * 100M-Scale Direct-to-S3 Presigned Upload Flow:
   * - If SHA-256 already exists in `source_blobs`, returns `deduplicated: true` with 0 upload bytes!
   * - Otherwise returns a presigned S3/R2/MinIO PUT URL so client uploads directly to object storage.
   */
  async createPresignedUpload(courseId: string, userId: string, dto: PresignUploadDto) {
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    const sha256 = dto.sha256.trim().toLowerCase();
    const sourceType = this.detectSourceType(dto.fileName);
    const ext = path.extname(dto.fileName).toLowerCase();

    const existing = await this.blobModel.findOne({ sha256 }).exec();
    if (existing && existing.status === 'ready') {
      await this.blobModel.findByIdAndUpdate(existing._id, {
        $inc: { refCount: 1 },
        $set: { lastAccessedAt: new Date() },
      });
      const courseSource = await this.upsertCourseSource({
        courseId,
        blobId: existing._id.toString(),
        userId,
        title: dto.fileName,
        sourceType,
        status: 'ready',
      });
      await this.syncCourseReadyFlags(courseId, dto.fileName, existing.pageCount, existing.charCount);
      return {
        success: true,
        message: 'Instant deduplication hit — file already indexed',
        data: {
          deduplicated: true,
          sourceId: courseSource._id.toString(),
          blobId: existing._id.toString(),
          status: 'ready',
        },
      };
    }

    const storageKey = this.storage.buildBlobKey(sha256, 'raw', ext);
    const blob =
      existing ||
      (await this.blobModel.create({
        sha256,
        sourceType,
        originalName: dto.fileName,
        mimeType: dto.mimeType,
        byteSize: dto.byteSize || 0,
        storageKey,
        status: 'pending_upload',
        refCount: 1,
      }));

    const courseSource = await this.upsertCourseSource({
      courseId,
      blobId: blob._id.toString(),
      userId,
      title: dto.fileName,
      sourceType,
      status: 'pending_upload',
    });

    const upload = await this.storage.getPresignedUploadUrl(storageKey, dto.mimeType);
    return {
      success: true,
      message: upload.driver === 's3' ? 'Presigned upload URL generated' : 'Use multipart upload in local mode',
      data: {
        deduplicated: false,
        sourceId: courseSource._id.toString(),
        blobId: blob._id.toString(),
        storageKey,
        upload,
      },
    };
  }

  /** Trigger ingestion after client finishes PUT to presigned S3 URL */
  async confirmPresignedUpload(sourceId: string, userId: string) {
    const cs = await this.courseSourceModel.findById(sourceId).populate('blob').exec();
    if (!cs) throw new NotFoundException('Source not found');

    await this.sourceAccess.assertCourseAccess(cs.course.toString(), userId);
    const blob = cs.blob as unknown as SourceBlobDocument;

    if (blob.status === 'ready') {
      cs.status = 'ready';
      await cs.save();
      return { success: true, message: 'Source already ready', data: { sourceId, status: 'ready' } };
    }

    const exists = await this.storage.exists(blob.storageKey);
    if (!exists) {
      throw new BadRequestException('Uploaded object not found in storage yet');
    }

    blob.status = 'queued';
    await blob.save();
    cs.status = 'queued';
    await cs.save();

    const job = await this.ingestion.enqueue({
      kind: 'file',
      blobId: blob._id.toString(),
      courseId: cs.course.toString(),
      courseSourceId: cs._id.toString(),
      sourceName: cs.title,
      sourceType: cs.sourceType,
      storageKey: blob.storageKey,
    });

    return {
      success: true,
      message: 'Ingestion queued',
      data: { sourceId, blobId: blob._id.toString(), status: 'queued', jobId: job.jobId },
    };
  }

  /** Ingest a public Web URL or YouTube Lecture URL */
  async ingestUrl(courseId: string, userId: string, dto: IngestUrlDto) {
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    const canonicalUrl = dto.url.trim();
    const isYt = this.isYoutubeUrl(canonicalUrl);
    const sourceType: SourceType = isYt ? 'youtube' : 'url';
    const sha256 = this.storage.sha256(`${sourceType}:${canonicalUrl}`);
    const title = dto.title?.trim() || canonicalUrl;

    let blob = await this.blobModel.findOne({ sha256 }).exec();
    if (blob && blob.status === 'ready') {
      await this.blobModel.findByIdAndUpdate(blob._id, {
        $inc: { refCount: 1 },
        $set: { lastAccessedAt: new Date() },
      });
      const cs = await this.upsertCourseSource({
        courseId,
        blobId: blob._id.toString(),
        userId,
        title,
        sourceType,
        originUrl: canonicalUrl,
        status: 'ready',
      });
      await this.syncCourseReadyFlags(courseId, title, blob.pageCount, blob.charCount);
      return {
        success: true,
        message: 'URL source linked instantly via deduplication',
        data: { sourceId: cs._id.toString(), blobId: blob._id.toString(), status: 'ready', deduplicated: true },
      };
    }

    if (!blob) {
      blob = await this.blobModel.create({
        sha256,
        canonicalUrl,
        sourceType,
        originalName: title,
        mimeType: 'text/html',
        status: 'queued',
        refCount: 1,
      });
    }

    const cs = await this.upsertCourseSource({
      courseId,
      blobId: blob._id.toString(),
      userId,
      title,
      sourceType,
      originUrl: canonicalUrl,
      status: 'queued',
    });

    const job = await this.ingestion.enqueue(
      {
        kind: isYt ? 'youtube' : 'url',
        blobId: blob._id.toString(),
        courseId,
        courseSourceId: cs._id.toString(),
        sourceName: title,
        sourceType,
        url: canonicalUrl,
      },
      1,
    );

    return {
      success: true,
      message: `${isYt ? 'YouTube' : 'Web'} source queued for ingestion`,
      data: {
        sourceId: cs._id.toString(),
        blobId: blob._id.toString(),
        sourceType,
        status: 'queued',
        jobId: job.jobId,
      },
    };
  }

  /** Ingest raw pasted study notes */
  async ingestNote(courseId: string, userId: string, dto: IngestNoteDto) {
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    const content = dto.content.trim();
    const sha256 = this.storage.sha256(`note:${content}`);

    let blob = await this.blobModel.findOne({ sha256 }).exec();
    if (blob && blob.status === 'ready') {
      await this.blobModel.findByIdAndUpdate(blob._id, {
        $inc: { refCount: 1 },
        $set: { lastAccessedAt: new Date() },
      });
      const cs = await this.upsertCourseSource({
        courseId,
        blobId: blob._id.toString(),
        userId,
        title: dto.title.trim(),
        sourceType: 'note',
        status: 'ready',
      });
      await this.syncCourseReadyFlags(courseId, dto.title.trim(), blob.pageCount, blob.charCount);
      return {
        success: true,
        message: 'Note linked instantly via deduplication',
        data: { sourceId: cs._id.toString(), blobId: blob._id.toString(), status: 'ready', deduplicated: true },
      };
    }

    if (!blob) {
      blob = await this.blobModel.create({
        sha256,
        sourceType: 'note',
        originalName: dto.title.trim(),
        mimeType: 'text/markdown',
        byteSize: Buffer.byteLength(content, 'utf8'),
        status: 'queued',
        refCount: 1,
      });
    }

    const cs = await this.upsertCourseSource({
      courseId,
      blobId: blob._id.toString(),
      userId,
      title: dto.title.trim(),
      sourceType: 'note',
      status: 'queued',
    });

    const job = await this.ingestion.enqueue(
      {
        kind: 'note',
        blobId: blob._id.toString(),
        courseId,
        courseSourceId: cs._id.toString(),
        sourceName: dto.title.trim(),
        sourceType: 'note',
        textContent: content,
      },
      1,
    );

    return {
      success: true,
      message: 'Note queued for indexing',
      data: { sourceId: cs._id.toString(), blobId: blob._id.toString(), status: 'queued', jobId: job.jobId },
    };
  }

  /** List all sources in a Course Notebook with status, TOC, and token stats */
  async listCourseSources(courseId: string, userId: string) {
    await this.sourceAccess.assertCourseAccess(courseId, userId);

    const sources = await this.courseSourceModel
      .find({ course: new Types.ObjectId(courseId) })
      .populate(
        'blob',
        'sourceType byteSize pageCount charCount tokenEstimate chunkCount parentCount extractionMethod embeddingModel status errorMessage toc summary vectorTier',
      )
      .sort({ createdAt: -1 })
      .lean();

    return {
      success: true,
      message: 'Sources retrieved',
      data: {
        courseId,
        count: sources.length,
        sources: sources.map((s: any) => ({
          id: s._id,
          blobId: s.blob?._id || s.blob,
          title: s.title,
          sourceType: s.sourceType,
          originUrl: s.originUrl || '',
          enabled: s.enabled,
          status: s.blob?.status || s.status,
          errorMessage: s.blob?.errorMessage || s.errorMessage || '',
          pageCount: s.blob?.pageCount || 1,
          charCount: s.blob?.charCount || 0,
          tokenEstimate: s.blob?.tokenEstimate || 0,
          chunkCount: s.blob?.chunkCount || 0,
          parentCount: s.blob?.parentCount || 0,
          extractionMethod: s.blob?.extractionMethod || '',
          toc: s.blob?.toc || [],
          summary: s.blob?.summary || '',
          createdAt: s.createdAt,
        })),
      },
    };
  }

  /** Toggle a source ON/OFF (NotebookLM source checkbox) */
  async toggleSource(sourceId: string, userId: string, enabled: boolean) {
    const cs = await this.courseSourceModel.findById(sourceId).exec();
    if (!cs) throw new NotFoundException('Source not found');
    await this.sourceAccess.assertCourseAccess(cs.course.toString(), userId);

    cs.enabled = enabled;
    await cs.save();
    return {
      success: true,
      message: `Source ${enabled ? 'enabled' : 'disabled'}`,
      data: { sourceId, enabled: cs.enabled },
    };
  }

  /** Fetch exact parent passage for NotebookLM clickable citation inspector */
  async getPassage(sourceId: string, parentIndex: number, userId: string) {
    const cs = await this.courseSourceModel.findById(sourceId).lean();
    if (!cs) throw new NotFoundException('Source not found');
    await this.sourceAccess.assertCourseAccess(cs.course.toString(), userId);

    const chunk = await this.parentChunkModel
      .findOne({ blob: cs.blob, parentIndex })
      .lean();
    if (!chunk) throw new NotFoundException('Passage not found');

    return {
      success: true,
      data: {
        sourceId,
        sourceTitle: cs.title,
        parentIndex: chunk.parentIndex,
        sectionPath: chunk.sectionPath,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        text: chunk.text,
        hasFormula: chunk.hasFormula,
        hasTable: chunk.hasTable,
      },
    };
  }

  /** Remove source from Course; only delete underlying blob + Qdrant vectors when refCount hits 0 */
  async deleteSource(sourceId: string, userId: string) {
    const cs = await this.courseSourceModel.findById(sourceId).exec();
    if (!cs) throw new NotFoundException('Source not found');
    await this.sourceAccess.assertCourseAccess(cs.course.toString(), userId, true);

    const blobId = cs.blob.toString();
    const courseId = cs.course.toString();
    await this.courseSourceModel.findByIdAndDelete(sourceId);

    const updatedBlob = await this.blobModel
      .findByIdAndUpdate(blobId, { $inc: { refCount: -1 } }, { new: true })
      .exec();

    let blobPurged = false;
    if (updatedBlob && updatedBlob.refCount <= 0) {
      blobPurged = true;
      await this.qdrant.deleteBlobChunks(blobId).catch((err) => {
        this.logger.warn(`Failed to delete Qdrant points for blob ${blobId}: ${err.message}`);
      });
      await this.parentChunkModel.deleteMany({ blob: updatedBlob._id });
      await this.storage.deleteObject(updatedBlob.storageKey);
      await this.storage.deleteObject(updatedBlob.markdownKey);
      await this.blobModel.findByIdAndDelete(blobId);
    }

    const remainingCount = await this.courseSourceModel.countDocuments({
      course: new Types.ObjectId(courseId),
      status: 'ready',
    });
    await this.courseModel.findByIdAndUpdate(courseId, {
      $set: { sourceCount: remainingCount, pdfProcessed: remainingCount > 0 },
    });

    return {
      success: true,
      message: 'Source removed from course',
      data: { sourceId, blobPurged },
    };
  }

  /** Assemble combined Markdown for all enabled sources (used by Quiz/Flashcard & Long-Context Router) */
  async getEnabledSourcesContent(
    courseId: string,
    sourceIds?: string[],
    maxTotalChars = 300_000,
  ): Promise<{
    sources: Array<{
      sourceId: string;
      blobId: string;
      title: string;
      sourceType: string;
      tokenEstimate: number;
      pageCount: number;
      toc: any[];
      markdown: string;
    }>;
    combinedMarkdown: string;
    totalTokens: number;
  }> {
    const query: any = {
      course: new Types.ObjectId(courseId),
      status: 'ready',
    };
    if (sourceIds && sourceIds.length > 0) {
      const validIds = sourceIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
      query._id = { $in: validIds };
    } else {
      query.enabled = true;
    }

    const links = await this.courseSourceModel
      .find(query)
      .populate('blob')
      .sort({ createdAt: 1 })
      .lean();

    const loaded: Array<{
      sourceId: string;
      blobId: string;
      title: string;
      sourceType: string;
      tokenEstimate: number;
      pageCount: number;
      toc: any[];
      markdown: string;
    }> = [];

    let usedChars = 0;
    let totalTokens = 0;

    for (const link of links as any[]) {
      const blob = link.blob;
      if (!blob) continue;

      let md = '';
      if (blob.markdownKey) {
        try {
          md = await this.storage.getObjectText(blob.markdownKey);
        } catch {
          md = blob.summary || '';
        }
      }
      if (!md) {
        const parents = await this.parentChunkModel
          .find({ blob: blob._id })
          .sort({ parentIndex: 1 })
          .select('text')
          .lean();
        md = parents.map((p: any) => p.text).join('\n\n');
      }

      const remaining = Math.max(0, maxTotalChars - usedChars);
      const sliced = md.length > remaining ? md.slice(0, remaining) + '\n[... truncated ...]' : md;
      usedChars += sliced.length;
      totalTokens += Number(blob.tokenEstimate || Math.ceil(md.length / 4));

      loaded.push({
        sourceId: link._id.toString(),
        blobId: blob._id.toString(),
        title: link.title,
        sourceType: link.sourceType,
        tokenEstimate: Number(blob.tokenEstimate || 0),
        pageCount: Number(blob.pageCount || 1),
        toc: blob.toc || [],
        markdown: sliced,
      });

      // Touch lastAccessedAt for Hot/Cold tier tracking
      this.blobModel.findByIdAndUpdate(blob._id, { $set: { lastAccessedAt: new Date() } }).catch(() => undefined);
    }

    const combinedMarkdown = loaded
      .map((s, idx) => `=== SOURCE [${idx + 1}]: ${s.title} (${s.sourceType}) ===\n${s.markdown}`)
      .join('\n\n');

    return { sources: loaded, combinedMarkdown, totalTokens };
  }

  private async upsertCourseSource(params: {
    courseId: string;
    blobId: string;
    userId: string;
    title: string;
    sourceType: SourceType;
    originUrl?: string;
    status: string;
  }): Promise<CourseSourceDocument> {
    return this.courseSourceModel
      .findOneAndUpdate(
        {
          course: new Types.ObjectId(params.courseId),
          blob: new Types.ObjectId(params.blobId),
        },
        {
          $setOnInsert: {
            course: new Types.ObjectId(params.courseId),
            blob: new Types.ObjectId(params.blobId),
            addedBy: new Types.ObjectId(params.userId),
            enabled: true,
          },
          $set: {
            title: params.title,
            sourceType: params.sourceType,
            originUrl: params.originUrl || '',
            status: params.status,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  private async syncCourseReadyFlags(
    courseId: string,
    fileName: string,
    pageCount: number,
    charCount: number,
  ): Promise<void> {
    const count = await this.courseSourceModel.countDocuments({
      course: new Types.ObjectId(courseId),
      status: 'ready',
    });
    await this.courseModel.findByIdAndUpdate(courseId, {
      $set: {
        sourceCount: count,
        ragVersion: 2,
        pdfProcessed: true,
        pdfProcessedAt: new Date(),
        pdfFileName: fileName,
        pdfPageCount: pageCount,
        pdfCharCount: charCount,
      },
    });
  }
}

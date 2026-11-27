// src/upload/upload.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { IAppResponse } from '../interfaces/app-response.interface';
import { SourcesService } from '../rag/sources.service';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly sourcesService: SourcesService) {}

  async uploadDoc(
    files: Array<Express.Multer.File>,
    courseId?: string,
    userId?: string,
    options: { sync?: boolean } = {},
  ): Promise<IAppResponse<any>> {
    try {
      if (!files || files.length === 0) {
        return { success: false, message: 'No files uploaded', data: null };
      }

      if (courseId && courseId !== 'undefined' && courseId.trim() !== '' && userId) {
        const result = await this.sourcesService.ingestUploadedFiles(courseId, userId, files, {
          sync: options.sync ?? false,
        });

        return {
          success: true,
          message: 'Files uploaded and queued for Hybrid RAG indexing',
          data: {
            files: files.map((f) => ({ path: f.path, name: f.originalname })),
            sources: result.data.sources,
          },
        };
      }

      return {
        success: true,
        message: 'Files uploaded successfully',
        data: {
          files: files.map((f) => f.path),
          note: 'Include courseId to ingest and index files into Hybrid RAG',
        },
      };
    } catch (error: any) {
      this.logger.error(`Upload failed: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message || 'Upload failed',
        data: { error: error.message },
      };
    }
  }
}

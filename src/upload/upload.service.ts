// src/upload/upload.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PdfService } from '../pdf/pdf.service';
import { QdrantService } from '../qdrant/qdrant.service';
import { IAppResponse } from '../interfaces/app-response.interface';
import axios from 'axios';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private pdfService: PdfService,
    private qdrantService: QdrantService,
  ) {
    this.logger.log('[UploadService] Initialized');
  }

  async uploadDoc(files: Array<Express.Multer.File>, courseId?: string): Promise<IAppResponse<any>> {
    try {
      console.log('');
      console.log('UPLOAD SERVICE');
      console.log('Files:', files?.length || 0);
      console.log('CourseId:', courseId);
      console.log('CourseId type:', typeof courseId);
      console.log('CourseId valid:', !!courseId && courseId !== 'undefined' && courseId.trim() !== '');
      console.log('');

      if (!files || files.length === 0) {
        return { success: false, message: 'No files uploaded', data: null };
      }

      // Map uploaded files with metadata
      const uploadedFiles = files.map((f) => ({
        path: f.path,
        filename: f.filename,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      }));

      console.log('Uploaded files:', uploadedFiles.map(f => f.originalname));

      // If courseId is provided, attempt to process the first file with a parser
      if (courseId && courseId !== 'undefined' && courseId.trim() !== '') {
        console.log('Valid courseId detected, attempting file parsing...');

        const targetFile = files[0];
        console.log('Selected file for parsing:', targetFile?.originalname, targetFile?.mimetype);

        if (targetFile) {
          try {
            console.log('PROCESSING FILE');
            console.log('File: ' + targetFile.originalname);
            console.log('Course: ' + courseId);
            console.log('Path: ' + targetFile.path);

            const parseResult = await this.pdfService.processFileForCourse(
              courseId,
              targetFile.path,
            );

            console.log('PARSE RESULT', JSON.stringify(parseResult, null, 2));

            if ('status' in parseResult && parseResult.status && parseResult.status !== 200) {
              console.error('File processing returned error status');
              return {
                success: false,
                message: 'File uploaded but processing failed',
                data: { 
                  files: uploadedFiles.map((f) => ({ path: f.path, name: f.originalname })),
                  processing: parseResult,
                }
              };
            }

            this.logger.log('File processing successful! Now triggering PDF embedding...');
            
            // Trigger vector embedding to Qdrant (wait for it to complete)
            try {
              this.logger.log(`[uploadDoc] Calling triggerPDFEmbedding for course ${courseId}`);
              const embeddingResult = await this.triggerPDFEmbedding(courseId, targetFile.path);
              this.logger.log(`[uploadDoc] PDF embedding result: ${JSON.stringify(embeddingResult)}`);
            } catch (error) {
              this.logger.error(`[uploadDoc] Failed to trigger PDF embedding: ${error.message}`);
              // Continue anyway - embedding failure shouldn't block the upload
            }

            return {
              success: true,
              message: 'File uploaded and processed successfully',
              data: { 
                files: uploadedFiles.map((f) => ({ path: f.path, name: f.originalname })),
                processing: parseResult,
              }
            };
          } catch (error) {
            console.error('FILE PROCESSING ERROR', error);
            return {
              success: false,
              message: 'File uploaded but processing failed',
              data: { 
                files: uploadedFiles.map((f) => ({ path: f.path, name: f.originalname })),
                error: error.message,
              }
            };
          }
        }
      } else {
        console.log('No valid courseId provided - skipping file processing');
      }

      // No courseId, just return uploaded files
      return {
        success: true,
        message: 'File uploaded successfully',
        data: { 
          files: uploadedFiles.map((f) => f.path),
          note: 'To process PDF for a course, include courseId in the request',
        }
      };
    } catch (error) {
      console.error('');
      console.error('UPLOAD SERVICE ERROR');
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      console.error('');
      
      return { success: false, message: 'Upload failed', data: { error: error.message } };
    }
  }

  /**
   * Trigger PDF embedding for vector search
   * Called automatically after successful PDF processing
   */
  async triggerPDFEmbedding(
    courseId: string,
    filePath: string,
  ): Promise<any> {
    try {
      const doclingServiceUrl = process.env.DOCLING_SERVICE_URL || 'http://localhost:5000';

      this.logger.log(`[triggerPDFEmbedding] Starting for course ${courseId}...`);

      // Send file to docling service for embedding
      const formData = new FormData();
      const fileBuffer = require('fs').readFileSync(filePath);
      const blob = new Blob([fileBuffer]);
      formData.append('file', blob, require('path').basename(filePath));

      this.logger.log(`[triggerPDFEmbedding] Attempting Docling service at ${doclingServiceUrl}`);
      const response = await axios.post(
        `${doclingServiceUrl}/embed-pdf?course_id=${courseId}`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        },
      );

      this.logger.log(`[triggerPDFEmbedding] PDF embedding triggered successfully for course ${courseId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`[triggerPDFEmbedding] Docling service failed: ${error.message}`);
      return { 
        status: 'error',
        message: 'PDF embedding failed - Python Docling service is required',
        error: error.message,
      };
    }
  }
}
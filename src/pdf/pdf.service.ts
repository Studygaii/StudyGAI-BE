// src/pdf/pdf.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as fs from 'fs';
import { CourseDocument } from '../schemas/course.schema';
import { basename } from 'path';
import { DoclingService } from '../docling/docling.service';
import { QdrantService } from '../qdrant/qdrant.service';
import { CacheService } from '../cache/cache.service';

// Import pdf-parse as fallback
const pdfParse = require('pdf-parse');

// Try to require llama-parse if available
let llamaParse: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  llamaParse = require('llama-parse');
} catch (e) {
  llamaParse = null;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    @InjectModel('courses') private courseModel: Model<CourseDocument>,
    private doclingService: DoclingService,
    private cache: CacheService,
  ) {}

  /**
   * Extract text from PDF file using pdf-parse
   */
  async extractTextFromPDF(filePath: string): Promise<string> {
    try {
      // Read the PDF file
      const dataBuffer = fs.readFileSync(filePath);
      
      // Parse the PDF
      const data = await pdfParse(dataBuffer);
      
      // Return extracted text
      return data.text;
    } catch (error) {
      console.error('PDF extraction error:', error);
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  /**
   * Generic file parsing: use pdf-parse first, llama-parse only for complex docs (images/formulas)
   */
  async parseFileToText(filePath: string): Promise<string> {
    try {
      const ext = basename(filePath).split('.').pop()?.toLowerCase();

      // Primary: if file is PDF, use pdf-parse (faster, more reliable for text-only)
      if (ext === 'pdf') {
        const dataBuffer = require('fs').readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        const extractedText = data.text;

        // Heuristic: if very little text extracted relative to file size, document likely has many images/formulas
        // In that case, try llama-parse for better OCR/formula handling
        const fileSize = require('fs').statSync(filePath).size;
        const textDensity = extractedText.length / Math.max(1, fileSize);
        if (textDensity < 0.01 && llamaParse && typeof llamaParse.parse === 'function') {
          console.log('Low text density detected; attempting llama-parse for better image/formula extraction');
          try {
            const res = await llamaParse.parse(filePath);
            if (typeof res === 'string' && res.trim().length > 0) return res;
            if (res && res.text && res.text.trim().length > 0) return res.text;
          } catch (err) {
            console.warn('llama-parse failed; using pdf-parse result:', err?.message || err);
          }
        }

        return extractedText;
      }

      // Try docx/doc using mammoth if available
      if (ext === 'docx' || ext === 'doc' || ext === 'docm') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mammoth = require('mammoth');
          const buffer = require('fs').readFileSync(filePath);
          // mammoth expects an ArrayBuffer-like object
          const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
          const result = await mammoth.extractRawText({ arrayBuffer });
          if (result && result.value && result.value.trim().length > 0) return result.value;
        } catch (err) {
          console.warn('mammoth parse failed or not installed, falling back to text read:', err?.message || err);
        }
      }

      // Last resort: try to read file as utf8 text but detect binary-like content
      try {
        const buf = require('fs').readFileSync(filePath);
        // Heuristic: count non-printable bytes
        const str = buf.toString('utf8');
        const nonPrintable = (str.match(/[^\x09\x0A\x0D\x20-\x7E]/g) || []).length;
        const ratio = nonPrintable / Math.max(1, str.length);
        if (ratio > 0.1) {
          throw new Error('File appears to be binary or unsupported format. Convert to PDF or DOCX and try again.');
        }
        return str;
      } catch (err) {
        throw new Error('Unsupported file type and no parser available: ' + (err?.message || err));
      }
    } catch (error) {
      console.error('parseFileToText error:', error);
      throw error;
    }
  }

async savePdfContent(
  courseId: string,
  pdfText: string,
  options?: {
    pdfMarkdown?: string;
    pdfJson?: any;
    fileName?: string;
    pageCount?: number | null;
    charCount?: number | null;
  },
) {
  try {
    console.log('');
    console.log('SAVE PDF CONTENT');
    console.log('CourseId:', courseId);
    console.log('Text length:', pdfText.length);
    console.log('Text preview:', pdfText.substring(0, 100));

    // Validate courseId format
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      console.error('Invalid courseId format:', courseId);
      return { status: 400, error: 'Invalid course ID format' };
    }

    const markdownContent = options?.pdfMarkdown ?? pdfText;
    const sizeInMB = Buffer.byteLength(markdownContent, 'utf8') / (1024 * 1024);
    console.log(`PDF text size: ${sizeInMB.toFixed(2)} MB`);
    if (sizeInMB > 50) {
      return { status: 413, error: 'PDF content too large' };
    }
    const updatedCourse = await this.courseModel.findByIdAndUpdate(
      courseId,
      {
        $set: {
          pdfContent: markdownContent,
          pdfMarkdown: markdownContent,
          pdfJson: options?.pdfJson ?? null,
          pdfPageCount: options?.pageCount ?? null,
          pdfCharCount: options?.charCount ?? markdownContent.length,
          pdfProcessed: true,
          pdfProcessedAt: new Date(),
          pdfFileName: options?.fileName || 'document.pdf',
        },
      },
      { new: true },
    ).exec();

    if (!updatedCourse) {
      console.error('Course not found for update:', courseId);
      return { status: 404, error: 'Course not found' };
    }

    console.log('Update successful!');
    console.log('Updated course:', {
      id: updatedCourse._id,
      title: updatedCourse.title,
      pdfProcessed: updatedCourse.pdfProcessed,
      pdfContentLength: updatedCourse.pdfContent?.length || 0,
      pdfProcessedAt: updatedCourse.pdfProcessedAt,
      pdfPageCount: updatedCourse.pdfPageCount,
    });

    const verification = await this.courseModel
      .findById(courseId)
      .select('pdfContent pdfProcessed pdfProcessedAt pdfFileName pdfPageCount pdfCharCount')
      .lean()
      .exec();

    console.log('Verification:', {
      pdfProcessed: verification?.pdfProcessed,
      pdfContentLength: verification?.pdfContent?.length || 0,
      pdfProcessedAt: verification?.pdfProcessedAt,
      pdfFileName: verification?.pdfFileName,
      pdfPageCount: verification?.pdfPageCount,
      pdfCharCount: verification?.pdfCharCount,
    });
    console.log('=================================');
    console.log('');

    const payload = {
      status: 200,
      message: 'PDF content saved successfully',
      courseId: updatedCourse._id.toString(),
      contentLength: markdownContent.length,
    };

    // cache for quick access
    await this.cache.set(`course:pdf:${courseId}`, {
      pdfMarkdown: markdownContent,
      pdfJson: options?.pdfJson ?? null,
    }, 600);

    return payload;
  } catch (error) {
    console.error('');
    console.error('SAVE ERROR');
    console.error('Error:', error);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('==========================');
    console.error('');

    return { status: 500, error: error.message };
  }
}
  /**
   * Get PDF content for a course
   */
  async getPdfContent(courseId: string): Promise<string | null> {
    try {
      const cached = await this.cache.get<{ pdfMarkdown?: string; pdfContent?: string }>(`course:pdf:${courseId}`);
      if (cached?.pdfMarkdown) return cached.pdfMarkdown;

      const course = await this.courseModel
        .findById(courseId)
        .select('pdfContent pdfMarkdown')
        .lean() as unknown as { pdfContent?: string; pdfMarkdown?: string } | null;
      const content = course?.pdfMarkdown || course?.pdfContent || null;
      if (content) {
        await this.cache.set(`course:pdf:${courseId}`, { pdfMarkdown: content }, 600);
      }
      return content;
    } catch (error) {
      throw new Error(`Failed to get PDF content: ${error.message}`);
    }
  }

  /**
   * Process uploaded PDF and save to course
   * Uses Docling service for conversion, falls back to pdf-parse if unavailable
   */
  async processFileForCourse(courseId: string, filePath: string) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return { status: 404, error: 'PDF file not found' };
      }

      this.logger.log(`Processing PDF: ${filePath} for course: ${courseId}`);

      let pdfText = '';
      let pdfJson: any = null;
      let pageCount: number | null = null;
      let charCount: number | null = null;
      const fileName = basename(filePath);
      const ext = fileName.split('.').pop()?.toLowerCase();

      // Try Docling service first for better structured output
      try {
        this.logger.log('Attempting to use Docling service for PDF conversion');
        const isHealthy = await this.doclingService.healthCheck();
        
        if (isHealthy) {
          const endpoint =
            ext === 'docx' ? '/convert-docx' : '/convert-pdf';
          const rich = await this.doclingService.convertFileRich(filePath, endpoint as any);
          pdfText = rich.markdown;
          pdfJson = rich.json || null;
          pageCount = rich.pageCount ?? null;
          charCount = rich.charCount ?? null;
          this.logger.log(
            `Docling conversion successful: ${pdfText.length} characters`,
          );
        } else {
          this.logger.warn(
            'Docling service unhealthy, falling back to pdf-parse',
          );
          pdfText = await this.parseFileToText(filePath);
        }
      } catch (doclingError) {
        this.logger.warn(
          `Docling conversion failed: ${(doclingError as Error).message}, falling back to pdf-parse`,
        );
        pdfText = await this.parseFileToText(filePath);
      }

      if (!pdfText || pdfText.trim().length === 0) {
        return { status: 400, error: 'No text could be extracted from PDF' };
      }

      this.logger.log(`Extracted ${pdfText.length} characters from PDF`);

      // Save to course
      const result = await this.savePdfContent(courseId, pdfText, {
        pdfMarkdown: pdfText,
        pdfJson,
        fileName,
        pageCount,
        charCount,
      });

      if (result.status && result.status !== 200) {
        return result;
      }

      // Optionally delete the file after processing (uncomment if needed)
      // fs.unlinkSync(filePath);

      return {
        message: 'PDF processed successfully',
        courseId,
        textLength: pdfText.length,
        hasStructured: !!pdfJson,
        pageCount,
        preview: pdfText.substring(0, 200) + '...',
      };
    } catch (error) {
      this.logger.error('Error processing PDF:', error);
      return { status: 500, error: (error as Error).message };
    }
  }

  /**
   * Get course info including PDF status
   */
  async getCourseWithPdfStatus(courseId: string) {
    try {
      const course = await this.courseModel
        .findById(courseId)
        .select('title pdfProcessed pdfProcessedAt pdfFileName pdfPageCount pdfCharCount')
        .lean() as unknown as { _id: any; title?: string; pdfProcessed?: boolean; pdfProcessedAt?: Date; pdfFileName?: string; pdfPageCount?: number | null; pdfCharCount?: number | null } | null;

      if (!course) {
        return { status: 404, error: 'Course not found' };
      }

      return {
        message: 'success',
        course: {
          id: course._id,
          title: course.title,
          pdfProcessed: !!course.pdfProcessed,
          pdfProcessedAt: course.pdfProcessedAt,
          pdfFileName: course.pdfFileName,
          pdfPageCount: course.pdfPageCount,
          pdfCharCount: course.pdfCharCount,
        },
      };
    } catch (error) {
      return { status: 500, error: error.message };
    }
  }
  /**
   * Chunk PDF text and store in Qdrant (fallback if Docling service fails)
   */
  async chunkAndEmbedPdf(
    courseId: string,
    pdfText: string,
    chunkSize: number = 512,
    overlap: number = 100,
    qdrantService?: any,
  ): Promise<{ status: number; message: string; chunked?: number; stored?: number; error?: string }> {
    this.logger.warn('[chunkAndEmbedPdf] DEPRECATED: This method uses the disabled NestJS embeddings service');
    this.logger.warn('[chunkAndEmbedPdf] Use Python Docling microservice instead (POST /embed-pdf)');
    return {
      status: 410, // 410 Gone - permanently unavailable
      message: 'chunkAndEmbedPdf is deprecated',
      error: 'Use Python Docling microservice POST /embed-pdf endpoint for embedding functionality',
    };
  }
}
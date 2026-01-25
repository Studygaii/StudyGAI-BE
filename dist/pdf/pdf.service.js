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
var PdfService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfService = void 0;
// src/pdf/pdf.service.ts
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const fs = __importStar(require("fs"));
const path_1 = require("path");
const docling_service_1 = require("../docling/docling.service");
const cache_service_1 = require("../cache/cache.service");
// Import pdf-parse as fallback
const pdfParse = require('pdf-parse');
// Try to require llama-parse if available
let llamaParse = null;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    llamaParse = require('llama-parse');
}
catch (e) {
    llamaParse = null;
}
let PdfService = PdfService_1 = class PdfService {
    constructor(courseModel, doclingService, cache) {
        this.courseModel = courseModel;
        this.doclingService = doclingService;
        this.cache = cache;
        this.logger = new common_1.Logger(PdfService_1.name);
    }
    /**
     * Extract text from PDF file using pdf-parse
     */
    async extractTextFromPDF(filePath) {
        try {
            // Read the PDF file
            const dataBuffer = fs.readFileSync(filePath);
            // Parse the PDF
            const data = await pdfParse(dataBuffer);
            // Return extracted text
            return data.text;
        }
        catch (error) {
            console.error('PDF extraction error:', error);
            throw new Error(`Failed to extract text from PDF: ${error.message}`);
        }
    }
    /**
     * Generic file parsing: use pdf-parse first, llama-parse only for complex docs (images/formulas)
     */
    async parseFileToText(filePath) {
        try {
            const ext = (0, path_1.basename)(filePath).split('.').pop()?.toLowerCase();
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
                        if (typeof res === 'string' && res.trim().length > 0)
                            return res;
                        if (res && res.text && res.text.trim().length > 0)
                            return res.text;
                    }
                    catch (err) {
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
                    if (result && result.value && result.value.trim().length > 0)
                        return result.value;
                }
                catch (err) {
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
            }
            catch (err) {
                throw new Error('Unsupported file type and no parser available: ' + (err?.message || err));
            }
        }
        catch (error) {
            console.error('parseFileToText error:', error);
            throw error;
        }
    }
    async savePdfContent(courseId, pdfText, options) {
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
            const updatedCourse = await this.courseModel.findByIdAndUpdate(courseId, {
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
            }, { new: true }).exec();
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
        }
        catch (error) {
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
    async getPdfContent(courseId) {
        try {
            const cached = await this.cache.get(`course:pdf:${courseId}`);
            if (cached?.pdfMarkdown)
                return cached.pdfMarkdown;
            const course = await this.courseModel
                .findById(courseId)
                .select('pdfContent pdfMarkdown')
                .lean();
            const content = course?.pdfMarkdown || course?.pdfContent || null;
            if (content) {
                await this.cache.set(`course:pdf:${courseId}`, { pdfMarkdown: content }, 600);
            }
            return content;
        }
        catch (error) {
            throw new Error(`Failed to get PDF content: ${error.message}`);
        }
    }
    /**
     * Process uploaded PDF and save to course
     * Uses Docling service for conversion, falls back to pdf-parse if unavailable
     */
    async processFileForCourse(courseId, filePath) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                return { status: 404, error: 'PDF file not found' };
            }
            this.logger.log(`Processing PDF: ${filePath} for course: ${courseId}`);
            let pdfText = '';
            let pdfJson = null;
            let pageCount = null;
            let charCount = null;
            const fileName = (0, path_1.basename)(filePath);
            const ext = fileName.split('.').pop()?.toLowerCase();
            // Try Docling service first for better structured output
            try {
                this.logger.log('Attempting to use Docling service for PDF conversion');
                const isHealthy = await this.doclingService.healthCheck();
                if (isHealthy) {
                    const endpoint = ext === 'docx' ? '/convert-docx' : '/convert-pdf';
                    const rich = await this.doclingService.convertFileRich(filePath, endpoint);
                    pdfText = rich.markdown;
                    pdfJson = rich.json || null;
                    pageCount = rich.pageCount ?? null;
                    charCount = rich.charCount ?? null;
                    this.logger.log(`Docling conversion successful: ${pdfText.length} characters`);
                }
                else {
                    this.logger.warn('Docling service unhealthy, falling back to pdf-parse');
                    pdfText = await this.parseFileToText(filePath);
                }
            }
            catch (doclingError) {
                this.logger.warn(`Docling conversion failed: ${doclingError.message}, falling back to pdf-parse`);
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
        }
        catch (error) {
            this.logger.error('Error processing PDF:', error);
            return { status: 500, error: error.message };
        }
    }
    /**
     * Get course info including PDF status
     */
    async getCourseWithPdfStatus(courseId) {
        try {
            const course = await this.courseModel
                .findById(courseId)
                .select('title pdfProcessed pdfProcessedAt pdfFileName pdfPageCount pdfCharCount')
                .lean();
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
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    /**
     * Chunk PDF text and store in Qdrant (fallback if Docling service fails)
     */
    async chunkAndEmbedPdf(courseId, pdfText, chunkSize = 512, overlap = 100, qdrantService) {
        try {
            this.logger.log(`[chunkAndEmbedPdf] Starting for course: ${courseId}, text length: ${pdfText?.length || 0}`);
            if (!pdfText || pdfText.trim().length === 0) {
                this.logger.warn(`[chunkAndEmbedPdf] Empty PDF text provided`);
                return { status: 400, message: 'Empty PDF text', error: 'No content to chunk' };
            }
            // Limit text to avoid memory issues - process in chunks
            // This ensures we don't create thousands of chunk objects at once
            const maxChunksPerBatch = 50;
            const charLimitPerBatch = 25000; // Process 25KB at a time
            // Determine how much text to process
            let textToProcess = pdfText;
            if (pdfText.length > charLimitPerBatch) {
                textToProcess = pdfText.substring(0, charLimitPerBatch);
                this.logger.log(`[chunkAndEmbedPdf] Processing first ${textToProcess.length} chars of ${pdfText.length} (batching)`);
            }
            // Split text into chunks with overlap
            const chunks = [];
            let start = 0;
            while (start < textToProcess.length) {
                const end = Math.min(start + chunkSize, textToProcess.length);
                const chunk = textToProcess.substring(start, end).trim();
                if (chunk.length > 0) {
                    chunks.push(chunk);
                }
                // Move start position, accounting for overlap
                start = end - overlap;
                if (start <= 0) {
                    break;
                }
                // Stop if we have too many chunks to avoid memory issues
                if (chunks.length >= maxChunksPerBatch) {
                    this.logger.log(`[chunkAndEmbedPdf] Reached batch limit of ${maxChunksPerBatch} chunks`);
                    break;
                }
            }
            this.logger.log(`[chunkAndEmbedPdf] Created ${chunks.length} chunks from PDF text`);
            if (chunks.length === 0) {
                this.logger.warn(`[chunkAndEmbedPdf] Could not create any chunks`);
                return { status: 400, message: 'Could not create chunks', error: 'Text too short' };
            }
            // Store chunks in Qdrant with embeddings
            try {
                if (!qdrantService) {
                    this.logger.warn(`[chunkAndEmbedPdf] No qdrantService provided, skipping storage`);
                    return { status: 200, message: 'PDF chunked but not stored (no service)', chunked: chunks.length };
                }
                this.logger.log(`[chunkAndEmbedPdf] Calling storeChunksWithEmbeddings with ${chunks.length} chunks`);
                const stats = await qdrantService.storeChunksWithEmbeddings(chunks, courseId, 'pdf_chunks');
                this.logger.log(`[chunkAndEmbedPdf] Embedding stats: ${JSON.stringify(stats)}`);
                if (stats.status === 'success' || stats.status === 'partial_success') {
                    this.logger.log(`[chunkAndEmbedPdf] Successfully stored chunks - pointsStored: ${stats.pointsStored}`);
                    return {
                        status: 200,
                        message: 'PDF chunked and stored successfully',
                        chunked: chunks.length,
                        stored: stats.pointsStored,
                    };
                }
                else {
                    this.logger.error(`[chunkAndEmbedPdf] Failed to generate embeddings: ${stats.status}`);
                    return {
                        status: 500,
                        message: 'Failed to generate embeddings for chunks',
                        chunked: chunks.length,
                        stored: 0,
                    };
                }
            }
            catch (qdrantError) {
                this.logger.error(`[chunkAndEmbedPdf] Qdrant error: ${qdrantError.message}`, qdrantError.stack);
                return {
                    status: 500,
                    message: 'PDF chunked but failed to store in Qdrant',
                    chunked: chunks.length,
                    stored: 0,
                    error: qdrantError.message,
                };
            }
        }
        catch (error) {
            this.logger.error(`[chunkAndEmbedPdf] Unexpected error: ${error.message}`, error.stack);
            return {
                status: 500,
                message: 'Failed to chunk and embed PDF',
                error: error.message,
            };
        }
    }
};
exports.PdfService = PdfService;
exports.PdfService = PdfService = PdfService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('courses')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        docling_service_1.DoclingService,
        cache_service_1.CacheService])
], PdfService);
//# sourceMappingURL=pdf.service.js.map
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
var UploadService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadService = void 0;
// src/upload/upload.service.ts
const common_1 = require("@nestjs/common");
const pdf_service_1 = require("../pdf/pdf.service");
const qdrant_service_1 = require("../qdrant/qdrant.service");
const axios_1 = __importDefault(require("axios"));
let UploadService = UploadService_1 = class UploadService {
    constructor(pdfService, qdrantService) {
        this.pdfService = pdfService;
        this.qdrantService = qdrantService;
        this.logger = new common_1.Logger(UploadService_1.name);
        this.logger.log('[UploadService] Initialized');
    }
    async uploadDoc(files, courseId) {
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
                        const parseResult = await this.pdfService.processFileForCourse(courseId, targetFile.path);
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
                        }
                        catch (error) {
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
                    }
                    catch (error) {
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
            }
            else {
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
        }
        catch (error) {
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
    async triggerPDFEmbedding(courseId, filePath) {
        try {
            const doclingServiceUrl = process.env.DOCLING_SERVICE_URL || 'http://localhost:5000';
            this.logger.log(`[triggerPDFEmbedding] Starting for course ${courseId}...`);
            // Send file to docling service for embedding
            const formData = new FormData();
            const fileBuffer = require('fs').readFileSync(filePath);
            const blob = new Blob([fileBuffer]);
            formData.append('file', blob, require('path').basename(filePath));
            this.logger.log(`[triggerPDFEmbedding] Attempting Docling service at ${doclingServiceUrl}`);
            const response = await axios_1.default.post(`${doclingServiceUrl}/embed-pdf?course_id=${courseId}`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });
            this.logger.log(`[triggerPDFEmbedding] PDF embedding triggered successfully for course ${courseId}`);
            return response.data;
        }
        catch (error) {
            this.logger.warn(`[triggerPDFEmbedding] Docling service failed: ${error.message}`);
            this.logger.log(`[triggerPDFEmbedding] Attempting fallback...`);
            // Fallback: Chunk the PDF directly in Node.js and store in Qdrant
            try {
                this.logger.log(`[triggerPDFEmbedding:fallback] Fetching pdfContent from MongoDB...`);
                // Get the extracted PDF content from the course
                const pdfContent = await this.pdfService.getPdfContent(courseId);
                if (!pdfContent) {
                    throw new Error(`No pdfContent found for course: ${courseId}`);
                }
                this.logger.log(`[triggerPDFEmbedding:fallback] Got pdfContent: ${pdfContent.length} chars`);
                // Chunk the PDF content
                this.logger.log(`[triggerPDFEmbedding:fallback] Calling chunkAndEmbedPdf...`);
                const chunkResult = await this.pdfService.chunkAndEmbedPdf(courseId, pdfContent, 512, 100, this.qdrantService);
                this.logger.log(`[triggerPDFEmbedding:fallback] Result: ${JSON.stringify(chunkResult)}`);
                if (chunkResult.status === 200) {
                    this.logger.log(`[triggerPDFEmbedding:fallback] SUCCESS - ${chunkResult.chunked} chunks, ${chunkResult.stored} stored`);
                    return {
                        status: 'success',
                        message: 'PDF processed with fallback chunking',
                        chunks: chunkResult.chunked,
                        stored: chunkResult.stored,
                    };
                }
                else {
                    throw new Error(`Chunking failed with status ${chunkResult.status}: ${chunkResult.error}`);
                }
            }
            catch (fallbackError) {
                this.logger.error(`[triggerPDFEmbedding:fallback] ERROR: ${fallbackError.message}`);
                return {
                    status: 'error',
                    message: 'PDF embedding and chunking failed',
                    error: fallbackError.message,
                };
            }
        }
    }
};
exports.UploadService = UploadService;
exports.UploadService = UploadService = UploadService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [pdf_service_1.PdfService,
        qdrant_service_1.QdrantService])
], UploadService);
//# sourceMappingURL=upload.service.js.map
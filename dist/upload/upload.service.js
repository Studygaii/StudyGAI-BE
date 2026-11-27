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
var UploadService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadService = void 0;
// src/upload/upload.service.ts
const common_1 = require("@nestjs/common");
const sources_service_1 = require("../rag/sources.service");
let UploadService = UploadService_1 = class UploadService {
    constructor(sourcesService) {
        this.sourcesService = sourcesService;
        this.logger = new common_1.Logger(UploadService_1.name);
    }
    async uploadDoc(files, courseId, userId, options = {}) {
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
        }
        catch (error) {
            this.logger.error(`Upload failed: ${error.message}`, error.stack);
            return {
                success: false,
                message: error.message || 'Upload failed',
                data: { error: error.message },
            };
        }
    }
};
exports.UploadService = UploadService;
exports.UploadService = UploadService = UploadService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [sources_service_1.SourcesService])
], UploadService);
//# sourceMappingURL=upload.service.js.map
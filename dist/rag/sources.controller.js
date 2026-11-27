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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourcesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const swagger_1 = require("@nestjs/swagger");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const multer_options_1 = require("../upload/multer.options");
const sources_service_1 = require("./sources.service");
const ingest_source_dto_1 = require("./dto/ingest-source.dto");
let SourcesController = class SourcesController {
    constructor(sourcesService) {
        this.sourcesService = sourcesService;
    }
    async uploadFiles(courseId, files, sync, mode, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.ingestUploadedFiles(courseId, userId, files, {
            sync: sync === 'true',
            mode: mode === 'accurate' ? 'accurate' : 'auto',
        });
    }
    async presignUpload(courseId, dto, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.createPresignedUpload(courseId, userId, dto);
    }
    async confirmUpload(sourceId, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.confirmPresignedUpload(sourceId, userId);
    }
    async ingestUrl(courseId, dto, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.ingestUrl(courseId, userId, dto);
    }
    async ingestNote(courseId, dto, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.ingestNote(courseId, userId, dto);
    }
    async listSources(courseId, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.listCourseSources(courseId, userId);
    }
    async toggleSource(sourceId, dto, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.toggleSource(sourceId, userId, dto.enabled);
    }
    async getPassage(sourceId, parentIndex, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.getPassage(sourceId, Number(parentIndex) || 0, userId);
    }
    async deleteSource(sourceId, req) {
        const userId = req.user?.id || req.user?._id;
        return this.sourcesService.deleteSource(sourceId, userId);
    }
};
exports.SourcesController = SourcesController;
__decorate([
    (0, common_1.Post)('course/:courseId/upload'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', 20, multer_options_1.multerOptions)),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: {
                files: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                },
            },
        },
    }),
    (0, swagger_1.ApiOperation)({
        summary: 'Upload up to 20 files to a course notebook with SHA-256 deduplication & async hybrid indexing',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.UploadedFiles)()),
    __param(2, (0, common_1.Query)('sync')),
    __param(3, (0, common_1.Query)('mode')),
    __param(4, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array, String, String, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "uploadFiles", null);
__decorate([
    (0, common_1.Post)('course/:courseId/presign'),
    (0, swagger_1.ApiOperation)({
        summary: 'Get a direct-to-S3/R2/MinIO presigned upload URL (or instant 0ms dedup hit)',
    }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ingest_source_dto_1.PresignUploadDto, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "presignUpload", null);
__decorate([
    (0, common_1.Post)(':sourceId/confirm'),
    (0, swagger_1.ApiOperation)({ summary: 'Confirm direct S3 upload completed and start async RAG indexing' }),
    __param(0, (0, common_1.Param)('sourceId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "confirmUpload", null);
__decorate([
    (0, common_1.Post)('course/:courseId/url'),
    (0, swagger_1.ApiOperation)({ summary: 'Ingest a public Web page or YouTube lecture URL into a course notebook' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ingest_source_dto_1.IngestUrlDto, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "ingestUrl", null);
__decorate([
    (0, common_1.Post)('course/:courseId/note'),
    (0, swagger_1.ApiOperation)({ summary: 'Ingest pasted study notes into a course notebook' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ingest_source_dto_1.IngestNoteDto, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "ingestNote", null);
__decorate([
    (0, common_1.Get)('course/:courseId'),
    (0, swagger_1.ApiOperation)({ summary: 'List all sources in a course notebook with ingestion status & TOC' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "listSources", null);
__decorate([
    (0, common_1.Patch)(':sourceId/toggle'),
    (0, swagger_1.ApiOperation)({ summary: 'Toggle a source ON/OFF for RAG chat and study tools (NotebookLM checkbox)' }),
    __param(0, (0, common_1.Param)('sourceId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ingest_source_dto_1.ToggleSourceDto, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "toggleSource", null);
__decorate([
    (0, common_1.Get)(':sourceId/passage/:parentIndex'),
    (0, swagger_1.ApiOperation)({ summary: 'Inspect exact cited parent passage for click-to-highlight citation UI' }),
    __param(0, (0, common_1.Param)('sourceId')),
    __param(1, (0, common_1.Param)('parentIndex')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "getPassage", null);
__decorate([
    (0, common_1.Delete)(':sourceId'),
    (0, swagger_1.ApiOperation)({ summary: 'Remove source from course (purges shared blob & vectors only if refCount reaches 0)' }),
    __param(0, (0, common_1.Param)('sourceId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SourcesController.prototype, "deleteSource", null);
exports.SourcesController = SourcesController = __decorate([
    (0, swagger_1.ApiTags)('Notebook Sources (RAG v2)'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('api/v1/sources'),
    __metadata("design:paramtypes", [sources_service_1.SourcesService])
], SourcesController);
//# sourceMappingURL=sources.controller.js.map
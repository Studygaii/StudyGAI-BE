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
exports.PdfController = void 0;
// src/pdf/pdf.controller.ts
const common_1 = require("@nestjs/common");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const pdf_service_1 = require("./pdf.service");
const swagger_1 = require("@nestjs/swagger");
const process_pdf_dto_1 = require("./dto/process-pdf.dto");
const save_pdf_content_dto_1 = require("./dto/save-pdf-content.dto");
const platform_express_1 = require("@nestjs/platform-express");
const multer_options_1 = require("../upload/multer.options");
const source_access_service_1 = require("../rag/source-access.service");
let PdfController = class PdfController {
    constructor(pdfService, sourceAccess) {
        this.pdfService = pdfService;
        this.sourceAccess = sourceAccess;
    }
    test() {
        return { msg: 'PDF Service Works!' };
    }
    async processPdf(courseId, body, req) {
        await this.sourceAccess.assertCourseAccess(courseId, req.user?.id || req.user?._id);
        return await this.pdfService.processFileForCourse(courseId, body.filePath);
    }
    async processPdfUpload(courseId, file, req) {
        if (!file) {
            return { status: 400, error: 'No file uploaded' };
        }
        await this.sourceAccess.assertCourseAccess(courseId, req.user?.id || req.user?._id);
        return await this.pdfService.processFileForCourse(courseId, file.path);
    }
    async getContent(courseId, req) {
        await this.sourceAccess.assertCourseAccess(courseId, req.user?.id || req.user?._id);
        try {
            const content = await this.pdfService.getPdfContent(courseId);
            if (!content) {
                return { status: 404, error: 'No PDF content found for this course' };
            }
            return {
                message: 'success',
                courseId,
                contentLength: content.length,
                preview: content.substring(0, 500) + '...', // Preview of content
            };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    async extractText(body, req) {
        try {
            const text = await this.pdfService.extractTextFromPDF(body.filePath);
            return {
                message: 'Text extracted successfully',
                textLength: text.length,
                preview: text.substring(0, 500) + '...',
            };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    async saveContent(body, req) {
        await this.sourceAccess.assertCourseAccess(body.courseId, req.user?.id || req.user?._id);
        return await this.pdfService.savePdfContent(body.courseId, body.pdfText);
    }
};
exports.PdfController = PdfController;
__decorate([
    (0, common_1.Get)('test'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PdfController.prototype, "test", null);
__decorate([
    (0, common_1.Post)('process/:courseId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Process PDF for a course' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'PDF processed successfully' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, process_pdf_dto_1.ProcessPdfDto, Object]),
    __metadata("design:returntype", Promise)
], PdfController.prototype, "processPdf", null);
__decorate([
    (0, common_1.Post)('process/:courseId/upload'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', multer_options_1.multerOptions)),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: {
                file: { type: 'string', format: 'binary' },
            },
        },
    }),
    (0, swagger_1.ApiOperation)({ summary: 'Upload and process PDF for a course' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'PDF uploaded and processed successfully' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], PdfController.prototype, "processPdfUpload", null);
__decorate([
    (0, common_1.Get)('content/:courseId'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Get PDF content for a course' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'PDF content retrieved' }),
    __param(0, (0, common_1.Param)('courseId')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PdfController.prototype, "getContent", null);
__decorate([
    (0, common_1.Post)('extract'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Extract text from PDF file' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Text extracted successfully' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [process_pdf_dto_1.ProcessPdfDto, Object]),
    __metadata("design:returntype", Promise)
], PdfController.prototype, "extractText", null);
__decorate([
    (0, common_1.Post)('save-content'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, swagger_1.ApiOperation)({ summary: 'Save extracted PDF content to course' }),
    (0, swagger_1.ApiResponse)({ status: 200, description: 'Content saved successfully' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [save_pdf_content_dto_1.SavePdfContentDto, Object]),
    __metadata("design:returntype", Promise)
], PdfController.prototype, "saveContent", null);
exports.PdfController = PdfController = __decorate([
    (0, swagger_1.ApiTags)('PDF'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('api/v1/pdf'),
    __metadata("design:paramtypes", [pdf_service_1.PdfService,
        source_access_service_1.SourceAccessService])
], PdfController);
//# sourceMappingURL=pdf.controller.js.map
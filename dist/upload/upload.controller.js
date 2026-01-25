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
exports.UploadController = void 0;
// src/upload/upload.controller.ts
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_options_1 = require("./multer.options");
const upload_service_1 = require("./upload.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const swagger_1 = require("@nestjs/swagger");
let UploadController = class UploadController {
    constructor(uploadService) {
        this.uploadService = uploadService;
    }
    async doc(files, courseIdQuery, body, req) {
        // Get courseId from query parameter (preferred) or body
        const courseId = courseIdQuery || body?.courseId || req.body?.courseId;
        console.log('[UploadController] doc() called');
        console.log('[UploadController] Files:', files?.length || 0);
        console.log('[UploadController] courseIdQuery:', courseIdQuery);
        console.log('[UploadController] body.courseId:', body?.courseId);
        console.log('[UploadController] Final courseId:', courseId);
        return await this.uploadService.uploadDoc(files, courseId);
    }
    test() {
        return { msg: 'Upload Works!' };
    }
};
exports.UploadController = UploadController;
__decorate([
    (0, common_1.Post)('doc')
    // @UseGuards(JwtAuthGuard) // TEMP: Disabled for testing embeddings
    ,
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', 10, multer_options_1.multerOptions)),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({
        schema: {
            type: 'object',
            properties: {
                files: {
                    type: 'array',
                    items: { type: 'string', format: 'binary' },
                },
                courseId: {
                    type: 'string',
                    example: '673c5e8f9a1b2c3d4e5f6789',
                },
            },
        },
    }),
    (0, swagger_1.ApiOperation)({ summary: 'Upload document(s) and optionally process PDF' }),
    (0, swagger_1.ApiResponse)({ status: 201, description: 'Files uploaded' }),
    __param(0, (0, common_1.UploadedFiles)()),
    __param(1, (0, common_1.Query)('courseId')),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Array, String, Object, Object]),
    __metadata("design:returntype", Promise)
], UploadController.prototype, "doc", null);
__decorate([
    (0, common_1.Get)('test'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UploadController.prototype, "test", null);
exports.UploadController = UploadController = __decorate([
    (0, swagger_1.ApiTags)('Upload'),
    (0, swagger_1.ApiBearerAuth)('jwt'),
    (0, common_1.Controller)('api/v1/upload'),
    __metadata("design:paramtypes", [upload_service_1.UploadService])
], UploadController);
//# sourceMappingURL=upload.controller.js.map
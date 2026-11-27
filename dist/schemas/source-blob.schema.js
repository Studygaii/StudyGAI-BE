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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SourceBlobSchema = exports.SourceBlob = void 0;
const mongoose_1 = require("@nestjs/mongoose");
let SourceBlob = class SourceBlob {
};
exports.SourceBlob = SourceBlob;
__decorate([
    (0, mongoose_1.Prop)({ required: true, unique: true, index: true }),
    __metadata("design:type", String)
], SourceBlob.prototype, "sha256", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, sparse: true, index: true }),
    __metadata("design:type", String)
], SourceBlob.prototype, "canonicalUrl", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: String,
        required: true,
        enum: ['pdf', 'docx', 'pptx', 'txt', 'markdown', 'image', 'url', 'youtube', 'audio', 'note'],
    }),
    __metadata("design:type", String)
], SourceBlob.prototype, "sourceType", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "originalName", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: 'application/octet-stream' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "mimeType", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], SourceBlob.prototype, "byteSize", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "storageKey", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "markdownKey", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: [
            {
                level: { type: Number, required: true },
                title: { type: String, required: true },
                page: { type: Number, default: 1 },
                parentIndex: { type: Number, default: 0 },
            },
        ],
        default: [],
    }),
    __metadata("design:type", Array)
], SourceBlob.prototype, "toc", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "summary", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 1 }),
    __metadata("design:type", Number)
], SourceBlob.prototype, "pageCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], SourceBlob.prototype, "charCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], SourceBlob.prototype, "tokenEstimate", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], SourceBlob.prototype, "parentCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], SourceBlob.prototype, "chunkCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "extractionMethod", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "embeddingModel", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: 'source_chunks' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "vectorCollection", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: String,
        enum: ['pending_upload', 'queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed'],
        default: 'queued',
        index: true,
    }),
    __metadata("design:type", String)
], SourceBlob.prototype, "status", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "errorMessage", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 1, index: true }),
    __metadata("design:type", Number)
], SourceBlob.prototype, "refCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, enum: ['hot', 'cold'], default: 'hot', index: true }),
    __metadata("design:type", String)
], SourceBlob.prototype, "vectorTier", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], SourceBlob.prototype, "vectorArchiveKey", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Date, default: Date.now, index: true }),
    __metadata("design:type", Date)
], SourceBlob.prototype, "lastAccessedAt", void 0);
exports.SourceBlob = SourceBlob = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'source_blobs' })
], SourceBlob);
exports.SourceBlobSchema = mongoose_1.SchemaFactory.createForClass(SourceBlob);
exports.SourceBlobSchema.index({ vectorTier: 1, lastAccessedAt: 1 });
//# sourceMappingURL=source-blob.schema.js.map
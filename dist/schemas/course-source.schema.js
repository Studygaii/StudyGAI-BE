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
exports.CourseSourceSchema = exports.CourseSource = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
/**
 * Links a Course (Notebook) to a deduplicated SourceBlob with NotebookLM-style
 * per-source selection (`enabled`), custom display title, and status tracking.
 */
let CourseSource = class CourseSource {
};
exports.CourseSource = CourseSource;
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'courses', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], CourseSource.prototype, "course", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'source_blobs', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], CourseSource.prototype, "blob", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'users', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], CourseSource.prototype, "addedBy", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, required: true }),
    __metadata("design:type", String)
], CourseSource.prototype, "title", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: String,
        required: true,
        enum: ['pdf', 'docx', 'pptx', 'txt', 'markdown', 'image', 'url', 'youtube', 'audio', 'note'],
    }),
    __metadata("design:type", String)
], CourseSource.prototype, "sourceType", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], CourseSource.prototype, "originUrl", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Boolean, default: true, index: true }),
    __metadata("design:type", Boolean)
], CourseSource.prototype, "enabled", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: String,
        enum: ['pending_upload', 'queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed'],
        default: 'queued',
        index: true,
    }),
    __metadata("design:type", String)
], CourseSource.prototype, "status", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], CourseSource.prototype, "errorMessage", void 0);
exports.CourseSource = CourseSource = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'course_sources' })
], CourseSource);
exports.CourseSourceSchema = mongoose_1.SchemaFactory.createForClass(CourseSource);
exports.CourseSourceSchema.index({ course: 1, blob: 1 }, { unique: true });
exports.CourseSourceSchema.index({ course: 1, enabled: 1, status: 1 });
//# sourceMappingURL=course-source.schema.js.map
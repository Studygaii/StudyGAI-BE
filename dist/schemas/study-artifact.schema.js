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
exports.StudyArtifactSchema = exports.StudyArtifact = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
/**
 * Persisted NotebookLM+ Study Studio artifacts (2-Host Audio Overviews,
 * High-Yield Exam Predictors, Study Guides) linked to a course notebook.
 */
let StudyArtifact = class StudyArtifact {
};
exports.StudyArtifact = StudyArtifact;
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'courses', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], StudyArtifact.prototype, "course", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'users', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], StudyArtifact.prototype, "createdBy", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: String,
        required: true,
        enum: ['audio_overview', 'exam_predictor', 'study_guide'],
        index: true,
    }),
    __metadata("design:type", String)
], StudyArtifact.prototype, "artifactType", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, required: true }),
    __metadata("design:type", String)
], StudyArtifact.prototype, "title", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], StudyArtifact.prototype, "subtitle", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [String], default: [] }),
    __metadata("design:type", Array)
], StudyArtifact.prototype, "sourceIds", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, required: true }),
    __metadata("design:type", Object)
], StudyArtifact.prototype, "payload", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], StudyArtifact.prototype, "estimatedDurationSec", void 0);
exports.StudyArtifact = StudyArtifact = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'study_artifacts' })
], StudyArtifact);
exports.StudyArtifactSchema = mongoose_1.SchemaFactory.createForClass(StudyArtifact);
exports.StudyArtifactSchema.index({ course: 1, artifactType: 1, createdAt: -1 });
//# sourceMappingURL=study-artifact.schema.js.map
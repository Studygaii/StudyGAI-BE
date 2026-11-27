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
exports.CourseSchema = exports.Course = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
let Course = class Course {
};
exports.Course = Course;
__decorate([
    (0, mongoose_1.Prop)({ required: true }),
    __metadata("design:type", String)
], Course.prototype, "title", void 0);
__decorate([
    (0, mongoose_1.Prop)(),
    __metadata("design:type", String)
], Course.prototype, "description", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'users', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], Course.prototype, "creator", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [{ type: mongoose_2.Types.ObjectId, ref: 'chats' }] }),
    __metadata("design:type", Array)
], Course.prototype, "chats", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [{ path: String, name: String }] }),
    __metadata("design:type", Array)
], Course.prototype, "files", void 0);
__decorate([
    (0, mongoose_1.Prop)({ default: Date.now }),
    __metadata("design:type", Date)
], Course.prototype, "date", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], Course.prototype, "sourceCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], Course.prototype, "totalTokens", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 2 }),
    __metadata("design:type", Number)
], Course.prototype, "ragVersion", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], Course.prototype, "pdfContent", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: '' }),
    __metadata("design:type", String)
], Course.prototype, "pdfMarkdown", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Object, default: null }),
    __metadata("design:type", Object)
], Course.prototype, "pdfJson", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: null }),
    __metadata("design:type", Number)
], Course.prototype, "pdfPageCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: null }),
    __metadata("design:type", Number)
], Course.prototype, "pdfCharCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Boolean, default: false }),
    __metadata("design:type", Boolean)
], Course.prototype, "pdfProcessed", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Date, default: null }),
    __metadata("design:type", Date)
], Course.prototype, "pdfProcessedAt", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: null }),
    __metadata("design:type", String)
], Course.prototype, "pdfFileName", void 0);
__decorate([
    (0, mongoose_1.Prop)({
        type: [
            {
                front: { type: String, required: true },
                back: { type: String, required: true },
                tags: { type: [String], default: [] },
                creator: { type: mongoose_2.Types.ObjectId, ref: 'users', required: true },
                easeFactor: { type: Number, default: 2.5 },
                interval: { type: Number, default: 0 },
                dueDate: { type: Date, default: null },
                reviewCount: { type: Number, default: 0 },
                lastReviewedAt: { type: Date },
                stats: { type: Map, of: Object, default: {} },
                createdAt: { type: Date, default: Date.now },
            },
        ],
        default: [],
    }),
    __metadata("design:type", Array)
], Course.prototype, "flashcards", void 0);
exports.Course = Course = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true })
], Course);
exports.CourseSchema = mongoose_1.SchemaFactory.createForClass(Course);
// Per-user unique course titles instead of global uniqueness
exports.CourseSchema.index({ creator: 1, title: 1 }, { unique: true });
// Pre-delete cleanup
exports.CourseSchema.pre('deleteOne', { document: true, query: false }, async function (next) {
    const mongoose = require('mongoose');
    await mongoose.model('chats').deleteMany({ _id: { $in: this.chats } });
    next();
});
//# sourceMappingURL=course.schema.js.map
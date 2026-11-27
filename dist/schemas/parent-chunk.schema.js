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
exports.ParentChunkSchema = exports.ParentChunk = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
/**
 * Stores larger parent sections (~1,000–1,400 tokens) decoupled from Course documents
 * and Qdrant child points, enabling Small-to-Big context expansion at query time.
 */
let ParentChunk = class ParentChunk {
};
exports.ParentChunk = ParentChunk;
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'source_blobs', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], ParentChunk.prototype, "blob", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, required: true }),
    __metadata("design:type", Number)
], ParentChunk.prototype, "parentIndex", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, required: true }),
    __metadata("design:type", String)
], ParentChunk.prototype, "text", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, default: 'Document' }),
    __metadata("design:type", String)
], ParentChunk.prototype, "sectionPath", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 1 }),
    __metadata("design:type", Number)
], ParentChunk.prototype, "pageStart", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 1 }),
    __metadata("design:type", Number)
], ParentChunk.prototype, "pageEnd", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], ParentChunk.prototype, "tokenCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Boolean, default: false }),
    __metadata("design:type", Boolean)
], ParentChunk.prototype, "hasFormula", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Boolean, default: false }),
    __metadata("design:type", Boolean)
], ParentChunk.prototype, "hasTable", void 0);
exports.ParentChunk = ParentChunk = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'parent_chunks' })
], ParentChunk);
exports.ParentChunkSchema = mongoose_1.SchemaFactory.createForClass(ParentChunk);
exports.ParentChunkSchema.index({ blob: 1, parentIndex: 1 }, { unique: true });
//# sourceMappingURL=parent-chunk.schema.js.map
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
exports.UserMasterySchema = exports.UserMastery = void 0;
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
/**
 * Per-user, per-course Concept Mastery record for Mastery-Aware Adaptive RAG.
 * Updated automatically from Quiz attempts and Anki Flashcard reviews.
 * Indexed by `{ user, course, conceptKey }` (unique) for O(1) lookups at 100M+ scale.
 */
let UserMastery = class UserMastery {
};
exports.UserMastery = UserMastery;
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'users', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], UserMastery.prototype, "user", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: mongoose_2.Types.ObjectId, ref: 'courses', required: true, index: true }),
    __metadata("design:type", mongoose_2.Types.ObjectId)
], UserMastery.prototype, "course", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, required: true }),
    __metadata("design:type", String)
], UserMastery.prototype, "conceptKey", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: String, required: true }),
    __metadata("design:type", String)
], UserMastery.prototype, "label", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 50, min: 0, max: 100 }),
    __metadata("design:type", Number)
], UserMastery.prototype, "masteryScore", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], UserMastery.prototype, "attempts", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], UserMastery.prototype, "correctCount", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Number, default: 0 }),
    __metadata("design:type", Number)
], UserMastery.prototype, "streak", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: [String], default: [] }),
    __metadata("design:type", Array)
], UserMastery.prototype, "recentMisses", void 0);
__decorate([
    (0, mongoose_1.Prop)({ type: Date, default: Date.now }),
    __metadata("design:type", Date)
], UserMastery.prototype, "lastReviewedAt", void 0);
exports.UserMastery = UserMastery = __decorate([
    (0, mongoose_1.Schema)({ timestamps: true, collection: 'user_masteries' })
], UserMastery);
exports.UserMasterySchema = mongoose_1.SchemaFactory.createForClass(UserMastery);
exports.UserMasterySchema.index({ user: 1, course: 1, conceptKey: 1 }, { unique: true });
exports.UserMasterySchema.index({ user: 1, course: 1, masteryScore: 1 });
//# sourceMappingURL=user-mastery.schema.js.map
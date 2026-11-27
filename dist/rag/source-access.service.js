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
exports.SourceAccessService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
/**
 * Centralized Multi-Tenant Access Control for Courses / Notebooks.
 * Verifies a user is either the course creator OR a member of a GroupChat linked to the course.
 */
let SourceAccessService = class SourceAccessService {
    constructor(courseModel, groupChatModel) {
        this.courseModel = courseModel;
        this.groupChatModel = groupChatModel;
    }
    async assertCourseAccess(courseId, userId, requireOwner = false) {
        if (!mongoose_2.Types.ObjectId.isValid(courseId)) {
            throw new common_1.NotFoundException('Invalid course ID');
        }
        const course = await this.courseModel
            .findById(courseId)
            .select('_id title creator pdfProcessed pdfFileName sourceCount totalTokens')
            .exec();
        if (!course) {
            throw new common_1.NotFoundException('Course not found');
        }
        if (course.creator?.toString() === userId?.toString()) {
            return course;
        }
        if (requireOwner) {
            throw new common_1.ForbiddenException('Only the course owner can perform this action');
        }
        const memberGroup = await this.groupChatModel
            .exists({
            course: new mongoose_2.Types.ObjectId(courseId),
            $or: [
                { creator: new mongoose_2.Types.ObjectId(userId) },
                { members: new mongoose_2.Types.ObjectId(userId) },
            ],
        })
            .exec();
        if (!memberGroup) {
            throw new common_1.ForbiddenException('You do not have access to this course');
        }
        return course;
    }
};
exports.SourceAccessService = SourceAccessService;
exports.SourceAccessService = SourceAccessService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('courses')),
    __param(1, (0, mongoose_1.InjectModel)('groupchats')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model])
], SourceAccessService);
//# sourceMappingURL=source-access.service.js.map
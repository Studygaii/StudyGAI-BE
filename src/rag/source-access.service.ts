import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CourseDocument } from '../schemas/course.schema';
import { GroupChatDocument } from '../schemas/groupchat.schema';

/**
 * Centralized Multi-Tenant Access Control for Courses / Notebooks.
 * Verifies a user is either the course creator OR a member of a GroupChat linked to the course.
 */
@Injectable()
export class SourceAccessService {
  constructor(
    @InjectModel('courses') private readonly courseModel: Model<CourseDocument>,
    @InjectModel('groupchats') private readonly groupChatModel: Model<GroupChatDocument>,
  ) {}

  async assertCourseAccess(
    courseId: string,
    userId: string,
    requireOwner = false,
  ): Promise<CourseDocument> {
    if (!Types.ObjectId.isValid(courseId)) {
      throw new NotFoundException('Invalid course ID');
    }

    const course = await this.courseModel
      .findById(courseId)
      .select('_id title creator pdfProcessed pdfFileName sourceCount totalTokens')
      .exec();

    if (!course) {
      throw new NotFoundException('Course not found');
    }

    if (course.creator?.toString() === userId?.toString()) {
      return course;
    }

    if (requireOwner) {
      throw new ForbiddenException('Only the course owner can perform this action');
    }

    const memberGroup = await this.groupChatModel
      .exists({
        course: new Types.ObjectId(courseId),
        $or: [
          { creator: new Types.ObjectId(userId) },
          { members: new Types.ObjectId(userId) },
        ],
      })
      .exec();

    if (!memberGroup) {
      throw new ForbiddenException('You do not have access to this course');
    }

    return course;
  }
}

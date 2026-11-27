// src/course/course.service.ts

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CourseDocument } from '../schemas/course.schema';
import { IAppResponse } from '../interfaces/app-response.interface';

@Injectable()
export class CourseService {
  constructor(@InjectModel('courses') private courseModel: Model<CourseDocument>) {}

  async list(userId: string): Promise<IAppResponse<{ courses: any[] }>> {
    try {
      // Exclude multi-MB legacy blobs & flashcards from dashboard listings for fast 100M-scale reads
      const courses = await this.courseModel
        .find({ creator: userId })
        .select('-pdfContent -pdfMarkdown -pdfJson -flashcards')
        .populate('chats', '_id title createdAt')
        .sort({ createdAt: -1 })
        .lean();
      return {
        success: true,
        message: 'Courses retrieved successfully',
        data: { courses },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to retrieve courses: ${error.message}`,
      };
    }
  }

  async create(body: any, authenticatedUserId: string): Promise<IAppResponse<{ course: any }>> {
    const newCourse = new this.courseModel({
      title: body.title,
      description: body.description || '',
      creator: authenticatedUserId,
      chats: [],
      files: body.files || [],
      date: Date.now(),
      sourceCount: 0,
      totalTokens: 0,
      ragVersion: 2,
      pdfContent: '',
      pdfMarkdown: '',
      pdfJson: null,
      pdfPageCount: null,
      pdfCharCount: null,
      pdfProcessed: false,
      pdfProcessedAt: null,
      pdfFileName: null,
    });

    try {
      const course = await newCourse.save();
      return {
        success: true,
        message: 'Course created successfully',
        data: { course },
      };
    } catch (error: any) {
      if (error.code === 11000 && (error.keyPattern?.title || error.keyPattern?.creator)) {
        return {
          success: false,
          message: 'You already have a course with this title',
        };
      }
      return {
        success: false,
        message: error.message || 'Failed to create course',
      };
    }
  }

  async remove(id: string, userId: string): Promise<IAppResponse<{ id: string }>> {
    try {
      const result = await this.courseModel.findOneAndDelete({
        _id: id,
        creator: userId,
      });

      if (!result) {
        return {
          success: false,
          message: 'Course not found',
        };
      }

      return {
        success: true,
        message: 'Course deleted successfully',
        data: { id },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete course: ${error.message}`,
      };
    }
  }
}

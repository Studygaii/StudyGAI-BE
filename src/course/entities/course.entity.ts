import { Types } from 'mongoose';

export interface ICourseFile {
  path: string;
  name: string;
}

export interface IEmbeddedFlashcard {
  front: string;
  back: string;
  tags: string[];
  creator: Types.ObjectId;
  easeFactor: number;
  interval: number;
  dueDate?: Date | null;
  reviewCount: number;
  lastReviewedAt?: Date;
  stats: Map<string, any>;
  createdAt?: Date;
}

export class CourseEntity {
  _id?: Types.ObjectId;
  title: string;
  description?: string;
  creator: Types.ObjectId;
  chats?: Types.ObjectId[];
  files?: ICourseFile[];
  date?: Date;
  pdfContent?: string;
  pdfMarkdown?: string;
  pdfJson?: Record<string, any> | null;
  pdfPageCount?: number | null;
  pdfCharCount?: number | null;
  pdfProcessed?: boolean;
  pdfProcessedAt?: Date | null;
  pdfFileName?: string | null;
  flashcards: IEmbeddedFlashcard[];
  createdAt?: Date;
  updatedAt?: Date;
}

export default CourseEntity;

import { Types } from 'mongoose';

export interface IFlashcardField {
  question: string;
  answer: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  lastReviewedAt?: Date;
  reviewCount?: number;
}

export class FlashcardEntity {
  _id?: Types.ObjectId;
  title: string;
  description?: string;
  creator: Types.ObjectId;
  course: Types.ObjectId;
  cards: IFlashcardField[];
  visibility: 'public' | 'private' | 'shared';
  sharedWith: Types.ObjectId[];
  totalCards: number;
  status: string;
  masteredCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export default FlashcardEntity;

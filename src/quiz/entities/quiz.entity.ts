import { Types } from 'mongoose';

export type QuizType = 'quiz' | 'exam';

export class QuizQuestionEntity {
  prompt: string;
  options: string[];
  answer: string;
  explanation?: string;
  kind: 'mcq' | 'short';
}

export class QuizAttemptAnswer {
  questionIndex: number;
  answer: string;
  correct: boolean;
}

export class QuizAttemptEntity {
  user: Types.ObjectId;
  score: number;
  total: number;
  percent: number;
  answers: QuizAttemptAnswer[];
  takenAt?: Date;
}

export class QuizEntity {
  _id?: Types.ObjectId;
  course: Types.ObjectId;
  createdBy: Types.ObjectId;
  quizType: QuizType;
  title?: string;
  groupId?: Types.ObjectId;
  questions: QuizQuestionEntity[];
  attempts: QuizAttemptEntity[];
  createdAt?: Date;
  updatedAt?: Date;
}

export default QuizEntity;

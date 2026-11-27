import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { QuizDocument, QuizType } from '../schemas/quiz.schema';
import { CourseDocument } from '../schemas/course.schema';
import { GroqService } from '../common/groq.service';
import { PdfService } from '../pdf/pdf.service';
import { CacheService } from '../cache/cache.service';
import { ChatGateway } from '../chat/chat.gateway';
import { MasteryService } from '../rag/mastery.service';
import { default as mongoose } from 'mongoose';

interface GeneratedQuiz {
  questions: {
    prompt: string;
    options: string[];
    answer: string;
    explanation?: string;
  }[];
}

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    @InjectModel('quizzes') private quizModel: Model<QuizDocument>,
    @InjectModel('courses') private courseModel: Model<CourseDocument>,
    private groq: GroqService,
    private pdfService: PdfService,
    private cache: CacheService,
    private chatGateway: ChatGateway,
    private masteryService: MasteryService,
  ) {}

  private normalize(str: string) {
    return (str || '')
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  }

  async generateQuiz(courseId: string, userId: string, opts: {
    numQuestions: number;
    quizType: QuizType;
    title?: string;
    groupId?: string;
  }) {
    const course = await this.courseModel.findById(courseId).lean();
    if (!course) return { status: 404, error: 'Course not found' };

    const pdfContent = await this.pdfService.getPdfContent(courseId);
    if (!pdfContent) return { status: 400, error: 'No course content available to generate quiz' };

    const prompt = this.buildQuizPrompt(pdfContent, opts.numQuestions, opts.quizType, course.title);
    const ai = await this.groq.getGroqChatCompletion([
      { role: 'system', content: 'You are an expert instructor. Return ONLY valid JSON. No markdown fences.' },
      { role: 'user', content: prompt },
    ]);

    const message = ai.choices?.[0]?.message?.content || '';
    const parsed = this.safeParseQuiz(message);
    if (!parsed) {
      return { status: 400, error: 'Failed to parse quiz from AI response', raw: message?.substring(0, 800) };
    }

    const quiz = await this.quizModel.create({
      course: new mongoose.Types.ObjectId(courseId),
      createdBy: new mongoose.Types.ObjectId(userId),
      quizType: opts.quizType,
      title: opts.title || `${opts.quizType === 'quiz' ? 'Quiz' : 'Exam'} - ${course.title}`,
      groupId: opts.groupId ? new mongoose.Types.ObjectId(opts.groupId) : undefined,
      questions: parsed.questions.map((q) => ({
        prompt: q.prompt,
        options: q.options || [],
        answer: q.answer,
        explanation: q.explanation || '',
      })),
      attempts: [],
    });

    return {
      message: 'generated',
      quizId: quiz._id,
      quizType: quiz.quizType,
      title: quiz.title,
      questionCount: quiz.questions.length,
    };
  }

  async listByCourse(courseId: string, quizType?: QuizType) {
    const filter: any = { course: new mongoose.Types.ObjectId(courseId) };
    if (quizType === 'quiz' || quizType === 'exam') {
      filter.quizType = quizType;
    }

    const quizzes = await this.quizModel
      .find(filter)
      .select('title quizType course createdBy groupId questions.prompt attempts createdAt')
      .sort({ createdAt: -1 })
      .lean();

    return {
      message: 'success',
      quizzes: quizzes.map((q: any) => ({
        _id: q._id,
        title: q.title,
        quizType: q.quizType,
        course: q.course,
        questionCount: q.questions?.length || 0,
        attemptCount: q.attempts?.length || 0,
        bestPercent: q.attempts?.length
          ? Math.max(...q.attempts.map((a: any) => Number(a.percent || 0)))
          : null,
        createdAt: q.createdAt,
      })),
    };
  }

  async getQuiz(quizId: string) {
    const cacheKey = `quiz:public:${quizId}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const quiz = await this.quizModel
      .findById(quizId)
      .select('-questions.answer') // hide answers for delivery
      .lean();
    if (!quiz) return { status: 404, error: 'Quiz not found' };

    const payload = { message: 'success', quiz };
    await this.cache.set(cacheKey, payload, 300);
    return payload;
  }

  async submit(quizId: string, userId: string, answers: { questionIndex: number; answer: string; }[]) {
    const quiz = await this.quizModel.findById(quizId);
    if (!quiz) return { status: 404, error: 'Quiz not found' };

    const normalizedAnswers = new Map<number, string>();
    for (const a of answers) {
      normalizedAnswers.set(a.questionIndex, this.normalize(a.answer));
    }

    let score = 0;
    const graded: { questionIndex: number; answer: string; correct: boolean }[] = [];
    quiz.questions.forEach((q, idx) => {
      const userAns = normalizedAnswers.get(idx) || '';
      const correctAnswer = this.normalize((q as any).answer);
      const isMcq = (q as any).options && (q as any).options.length > 0;
      let correct = userAns === correctAnswer;
      if (!isMcq && !correct) {
        const similarity = this.semanticSimilarity(userAns, correctAnswer);
        correct = similarity >= 0.6;
      }
      if (correct) score += 1;
      graded.push({ questionIndex: idx, answer: userAns, correct });
    });

    const total = quiz.questions.length || 1;
    const percent = Math.round((score / total) * 100);

    quiz.attempts.push({
      user: new mongoose.Types.ObjectId(userId),
      score,
      total,
      percent,
      answers: graded,
      takenAt: new Date(),
    } as any);

    await quiz.save();

    // Feed graded question outcomes into Mastery-Aware Adaptive RAG profile
    const masteryItems = quiz.questions.map((q, idx) => ({
      prompt: (q as any).prompt || '',
      correct: Boolean(graded[idx]?.correct),
    }));
    await this.masteryService
      .recordQuizOutcome(userId, quiz.course.toString(), masteryItems)
      .catch((err) => this.logger.warn(`Mastery quiz update skipped: ${err.message}`));

    // invalidate caches
    await this.cache.del([`quiz:public:${quizId}`, `quiz:lb:${quizId}`]);

    const result = {
      message: 'submitted',
      score,
      total,
      percent,
      correct: score,
      incorrect: total - score,
    };

    // push leaderboard update if groupId is present
    const leaderboard = await this.leaderboard(quizId, true);
    if (leaderboard && (quiz as any).groupId && this.chatGateway?.server) {
      this.chatGateway.server.to((quiz as any).groupId.toString()).emit('quiz-leaderboard', {
        quizId,
        leaderboard: leaderboard.leaderboard,
        title: leaderboard.title,
      });
    }

    return result;
  }

  async leaderboard(quizId: string, skipCache = false) {
    if (!skipCache) {
      const cached = await this.cache.get(`quiz:lb:${quizId}`);
      if (cached) return cached;
    }

    const quiz = await this.quizModel
      .findById(quizId)
      .select('attempts quizType title')
      .populate('attempts.user', 'name email')
      .lean();
    if (!quiz) return { status: 404, error: 'Quiz not found' };

    const attempts = (quiz.attempts || []).map((a: any) => ({
      user: a.user?._id || a.user,
      name: a.user?.name || a.user?.email || 'user',
      score: a.score,
      total: a.total,
      percent: a.percent,
      takenAt: a.takenAt,
    }));

    attempts.sort((a, b) => b.score - a.score || (a.takenAt || 0) - (b.takenAt || 0));
    const ranked = attempts.map((a, idx) => ({ rank: idx + 1, ...a }));

    const payload = {
      message: 'success',
      quizType: quiz.quizType,
      title: quiz.title,
      leaderboard: ranked,
    };
    await this.cache.set(`quiz:lb:${quizId}`, payload, 120);
    return payload;
  }

  private buildQuizPrompt(content: string, numQuestions: number, type: QuizType, courseTitle?: string) {
    const capped = content.length > 200000 ? content.substring(0, 200000) : content;
    return `Generate a ${type === 'exam' ? 'solo exam' : 'quiz'} with ${numQuestions} concise questions based ONLY on the material below.
- Prefer multiple-choice (4 options) and include the correct answer.
- If a short-answer is needed, keep the expected answer very short.
- Return ONLY valid JSON with this shape:
{
  "questions": [
    { "prompt": "...", "options": ["A","B","C","D"], "answer": "B", "explanation": "optional" }
  ]
}
Material title: ${courseTitle || 'Course'}
Material:
${capped}`;
  }

  private safeParseQuiz(raw: string): GeneratedQuiz | null {
    if (!raw) return null;
    const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const startIdx = cleaned.search(/[\[{]/);
    if (startIdx === -1) return null;
    const extract = (text: string) => {
      const open = text[startIdx];
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      for (let i = startIdx; i < text.length; i++) {
        const ch = text[i];
        if (ch === open) depth++;
        else if (ch === close) depth--;
        if (depth === 0) return text.substring(startIdx, i + 1);
      }
      return text.substring(startIdx);
    };
    try {
      const jsonStr = extract(cleaned);
      const parsed = JSON.parse(jsonStr);
      if (!parsed.questions || !Array.isArray(parsed.questions)) return null;
      return parsed;
    } catch (err) {
      this.logger.warn('Failed to parse quiz JSON', err as any);
      return null;
    }
  }

  private semanticSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const toTokens = (t: string) =>
      t
        .split(/\s+/)
        .map((w) => w.trim())
        .filter(Boolean);
    const aTokens = new Set(toTokens(a));
    const bTokens = new Set(toTokens(b));
    const intersection = new Set([...aTokens].filter((x) => bTokens.has(x)));
    const union = new Set([...aTokens, ...bTokens]);
    return union.size ? intersection.size / union.size : 0;
  }
}


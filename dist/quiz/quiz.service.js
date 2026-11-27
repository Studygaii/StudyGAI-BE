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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var QuizService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuizService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const groq_service_1 = require("../common/groq.service");
const pdf_service_1 = require("../pdf/pdf.service");
const cache_service_1 = require("../cache/cache.service");
const chat_gateway_1 = require("../chat/chat.gateway");
const mastery_service_1 = require("../rag/mastery.service");
const mongoose_3 = __importDefault(require("mongoose"));
let QuizService = QuizService_1 = class QuizService {
    constructor(quizModel, courseModel, groq, pdfService, cache, chatGateway, masteryService) {
        this.quizModel = quizModel;
        this.courseModel = courseModel;
        this.groq = groq;
        this.pdfService = pdfService;
        this.cache = cache;
        this.chatGateway = chatGateway;
        this.masteryService = masteryService;
        this.logger = new common_1.Logger(QuizService_1.name);
    }
    normalize(str) {
        return (str || '')
            .toString()
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .trim();
    }
    async generateQuiz(courseId, userId, opts) {
        const course = await this.courseModel.findById(courseId).lean();
        if (!course)
            return { status: 404, error: 'Course not found' };
        const pdfContent = await this.pdfService.getPdfContent(courseId);
        if (!pdfContent)
            return { status: 400, error: 'No course content available to generate quiz' };
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
            course: new mongoose_3.default.Types.ObjectId(courseId),
            createdBy: new mongoose_3.default.Types.ObjectId(userId),
            quizType: opts.quizType,
            title: opts.title || `${opts.quizType === 'quiz' ? 'Quiz' : 'Exam'} - ${course.title}`,
            groupId: opts.groupId ? new mongoose_3.default.Types.ObjectId(opts.groupId) : undefined,
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
    async listByCourse(courseId, quizType) {
        const filter = { course: new mongoose_3.default.Types.ObjectId(courseId) };
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
            quizzes: quizzes.map((q) => ({
                _id: q._id,
                title: q.title,
                quizType: q.quizType,
                course: q.course,
                questionCount: q.questions?.length || 0,
                attemptCount: q.attempts?.length || 0,
                bestPercent: q.attempts?.length
                    ? Math.max(...q.attempts.map((a) => Number(a.percent || 0)))
                    : null,
                createdAt: q.createdAt,
            })),
        };
    }
    async getQuiz(quizId) {
        const cacheKey = `quiz:public:${quizId}`;
        const cached = await this.cache.get(cacheKey);
        if (cached)
            return cached;
        const quiz = await this.quizModel
            .findById(quizId)
            .select('-questions.answer') // hide answers for delivery
            .lean();
        if (!quiz)
            return { status: 404, error: 'Quiz not found' };
        const payload = { message: 'success', quiz };
        await this.cache.set(cacheKey, payload, 300);
        return payload;
    }
    async submit(quizId, userId, answers) {
        const quiz = await this.quizModel.findById(quizId);
        if (!quiz)
            return { status: 404, error: 'Quiz not found' };
        const normalizedAnswers = new Map();
        for (const a of answers) {
            normalizedAnswers.set(a.questionIndex, this.normalize(a.answer));
        }
        let score = 0;
        const graded = [];
        quiz.questions.forEach((q, idx) => {
            const userAns = normalizedAnswers.get(idx) || '';
            const correctAnswer = this.normalize(q.answer);
            const isMcq = q.options && q.options.length > 0;
            let correct = userAns === correctAnswer;
            if (!isMcq && !correct) {
                const similarity = this.semanticSimilarity(userAns, correctAnswer);
                correct = similarity >= 0.6;
            }
            if (correct)
                score += 1;
            graded.push({ questionIndex: idx, answer: userAns, correct });
        });
        const total = quiz.questions.length || 1;
        const percent = Math.round((score / total) * 100);
        quiz.attempts.push({
            user: new mongoose_3.default.Types.ObjectId(userId),
            score,
            total,
            percent,
            answers: graded,
            takenAt: new Date(),
        });
        await quiz.save();
        // Feed graded question outcomes into Mastery-Aware Adaptive RAG profile
        const masteryItems = quiz.questions.map((q, idx) => ({
            prompt: q.prompt || '',
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
        if (leaderboard && quiz.groupId && this.chatGateway?.server) {
            this.chatGateway.server.to(quiz.groupId.toString()).emit('quiz-leaderboard', {
                quizId,
                leaderboard: leaderboard.leaderboard,
                title: leaderboard.title,
            });
        }
        return result;
    }
    async leaderboard(quizId, skipCache = false) {
        if (!skipCache) {
            const cached = await this.cache.get(`quiz:lb:${quizId}`);
            if (cached)
                return cached;
        }
        const quiz = await this.quizModel
            .findById(quizId)
            .select('attempts quizType title')
            .populate('attempts.user', 'name email')
            .lean();
        if (!quiz)
            return { status: 404, error: 'Quiz not found' };
        const attempts = (quiz.attempts || []).map((a) => ({
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
    buildQuizPrompt(content, numQuestions, type, courseTitle) {
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
    safeParseQuiz(raw) {
        if (!raw)
            return null;
        const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
        const startIdx = cleaned.search(/[\[{]/);
        if (startIdx === -1)
            return null;
        const extract = (text) => {
            const open = text[startIdx];
            const close = open === '{' ? '}' : ']';
            let depth = 0;
            for (let i = startIdx; i < text.length; i++) {
                const ch = text[i];
                if (ch === open)
                    depth++;
                else if (ch === close)
                    depth--;
                if (depth === 0)
                    return text.substring(startIdx, i + 1);
            }
            return text.substring(startIdx);
        };
        try {
            const jsonStr = extract(cleaned);
            const parsed = JSON.parse(jsonStr);
            if (!parsed.questions || !Array.isArray(parsed.questions))
                return null;
            return parsed;
        }
        catch (err) {
            this.logger.warn('Failed to parse quiz JSON', err);
            return null;
        }
    }
    semanticSimilarity(a, b) {
        if (!a || !b)
            return 0;
        const toTokens = (t) => t
            .split(/\s+/)
            .map((w) => w.trim())
            .filter(Boolean);
        const aTokens = new Set(toTokens(a));
        const bTokens = new Set(toTokens(b));
        const intersection = new Set([...aTokens].filter((x) => bTokens.has(x)));
        const union = new Set([...aTokens, ...bTokens]);
        return union.size ? intersection.size / union.size : 0;
    }
};
exports.QuizService = QuizService;
exports.QuizService = QuizService = QuizService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('quizzes')),
    __param(1, (0, mongoose_1.InjectModel)('courses')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        mongoose_2.Model,
        groq_service_1.GroqService,
        pdf_service_1.PdfService,
        cache_service_1.CacheService,
        chat_gateway_1.ChatGateway,
        mastery_service_1.MasteryService])
], QuizService);
//# sourceMappingURL=quiz.service.js.map
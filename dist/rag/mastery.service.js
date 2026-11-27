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
var MasteryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MasteryService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const cache_service_1 = require("../cache/cache.service");
const STOP = new Set([
    'what', 'which', 'when', 'where', 'does', 'that', 'this', 'with', 'from', 'into',
    'about', 'explain', 'define', 'describe', 'calculate', 'find', 'true', 'false',
    'following', 'correct', 'statement', 'question', 'answer', 'used', 'using', 'called',
    'best', 'most', 'your', 'their', 'these', 'those', 'have', 'been', 'will', 'would',
]);
/**
 * Mastery-Aware Adaptive Learning Engine.
 *
 * Bridges StudyGAI's Quizzes + Anki Flashcards directly into RAG retrieval and tutoring:
 * - Tracks per-concept mastery scores per user per course.
 * - Surfaces weak prerequisites and misconceptions into RagOrchestratorService.
 */
let MasteryService = MasteryService_1 = class MasteryService {
    constructor(masteryModel, cache) {
        this.masteryModel = masteryModel;
        this.cache = cache;
        this.logger = new common_1.Logger(MasteryService_1.name);
    }
    slugifyConcept(raw) {
        return (raw || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ' ')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 60);
    }
    /** Extract clean concept label(s) from a quiz prompt or flashcard */
    extractConceptsFromText(text, tags) {
        const out = [];
        const seen = new Set();
        // Prefer explicit non-generic tags first
        for (const tag of tags || []) {
            const cleaned = (tag || '').trim();
            if (!cleaned || cleaned.toLowerCase() === 'ai-generated')
                continue;
            const key = this.slugifyConcept(cleaned);
            if (key.length >= 2 && !seen.has(key)) {
                seen.add(key);
                out.push({ key, label: this.titleCase(cleaned) });
            }
        }
        if (out.length > 0)
            return out.slice(0, 3);
        // Fallback: extract key phrase from question text (quoted terms, capitalized terms, or key nouns)
        const clean = (text || '').replace(/[?!.:,()[\]"']/g, ' ');
        const words = clean
            .split(/\s+/)
            .filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()));
        if (words.length >= 2) {
            const phrase = words.slice(0, 3).join(' ');
            const key = this.slugifyConcept(phrase);
            if (key.length >= 3) {
                return [{ key, label: this.titleCase(phrase) }];
            }
        }
        else if (words.length === 1) {
            const key = this.slugifyConcept(words[0]);
            if (key.length >= 3) {
                return [{ key, label: this.titleCase(words[0]) }];
            }
        }
        return [{ key: 'general-concepts', label: 'Core Course Concepts' }];
    }
    /** Record mastery signals from every graded question in a Quiz or Exam submission */
    async recordQuizOutcome(userId, courseId, items) {
        if (!mongoose_2.Types.ObjectId.isValid(userId) || !mongoose_2.Types.ObjectId.isValid(courseId) || !items.length) {
            return;
        }
        for (const item of items) {
            const concepts = this.extractConceptsFromText(item.prompt);
            for (const c of concepts) {
                await this.applyMasteryDelta({
                    userId,
                    courseId,
                    conceptKey: c.key,
                    label: c.label,
                    correct: item.correct,
                    delta: item.correct ? 14 : -18,
                    missSnippet: item.correct ? undefined : item.prompt.slice(0, 140),
                });
            }
        }
        await this.invalidateCache(userId, courseId);
    }
    /** Record mastery signal from an Anki spaced-repetition flashcard review */
    async recordFlashcardOutcome(userId, courseId, card, difficulty) {
        if (!mongoose_2.Types.ObjectId.isValid(userId) || !mongoose_2.Types.ObjectId.isValid(courseId)) {
            return;
        }
        const d = (difficulty || 'Good').toLowerCase();
        const deltaMap = {
            again: { delta: -20, correct: false },
            hard: { delta: -6, correct: false },
            good: { delta: 10, correct: true },
            easy: { delta: 18, correct: true },
        };
        const { delta, correct } = deltaMap[d] || deltaMap.good;
        const concepts = this.extractConceptsFromText(card.front || '', card.tags);
        for (const c of concepts) {
            await this.applyMasteryDelta({
                userId,
                courseId,
                conceptKey: c.key,
                label: c.label,
                correct,
                delta,
                missSnippet: correct ? undefined : (card.front || '').slice(0, 140),
            });
        }
        await this.invalidateCache(userId, courseId);
    }
    async getLearnerProfile(userId, courseId) {
        const cacheKey = this.cacheKey(userId, courseId);
        const cached = await this.cache.get(cacheKey).catch(() => null);
        if (cached)
            return cached;
        const docs = await this.masteryModel
            .find({
            user: new mongoose_2.Types.ObjectId(userId),
            course: new mongoose_2.Types.ObjectId(courseId),
        })
            .sort({ masteryScore: 1 })
            .lean();
        const allConcepts = docs.map((d) => {
            const score = Math.round(Number(d.masteryScore ?? 50));
            return {
                conceptKey: d.conceptKey,
                label: d.label,
                masteryScore: score,
                attempts: Number(d.attempts || 0),
                correctCount: Number(d.correctCount || 0),
                streak: Number(d.streak || 0),
                status: score < 55 ? 'weak' : score < 80 ? 'learning' : 'mastered',
                recentMisses: Array.isArray(d.recentMisses) ? d.recentMisses.slice(-3) : [],
                lastReviewedAt: d.lastReviewedAt || d.updatedAt,
            };
        });
        const weakConcepts = allConcepts.filter((c) => c.status === 'weak');
        const learningConcepts = allConcepts.filter((c) => c.status === 'learning');
        const strongConcepts = allConcepts
            .filter((c) => c.status === 'mastered')
            .sort((a, b) => b.masteryScore - a.masteryScore);
        const totalSignals = allConcepts.reduce((sum, c) => sum + c.attempts, 0);
        const overallMastery = allConcepts.length > 0
            ? Math.round(allConcepts.reduce((sum, c) => sum + c.masteryScore, 0) / allConcepts.length)
            : 0;
        const profile = {
            courseId,
            userId,
            overallMastery,
            totalSignals,
            weakConcepts,
            learningConcepts,
            strongConcepts,
            allConcepts,
        };
        await this.cache.set(cacheKey, profile, 60).catch(() => undefined);
        return profile;
    }
    /**
     * Build a concise adaptive tutoring directive injected into RagOrchestratorService prompts
     * so explanations dynamically reinforce weak concepts and match the learner's level.
     */
    buildAdaptiveDirective(profile) {
        if (!profile || profile.totalSignals === 0)
            return '';
        const parts = [
            `\nADAPTIVE LEARNER PROFILE (Overall Course Mastery: ${profile.overallMastery}% across ${profile.allConcepts.length} tracked concepts):`,
        ];
        if (profile.weakConcepts.length > 0) {
            const weakStr = profile.weakConcepts
                .slice(0, 5)
                .map((c) => `${c.label} (${c.masteryScore}%)`)
                .join(', ');
            parts.push(`- Weak areas needing extra clarity & worked examples: ${weakStr}`);
        }
        if (profile.strongConcepts.length > 0) {
            const strongStr = profile.strongConcepts
                .slice(0, 4)
                .map((c) => `${c.label} (${c.masteryScore}%)`)
                .join(', ');
            parts.push(`- Already mastered (can reference concisely without over-explaining basics): ${strongStr}`);
        }
        parts.push(`- When the question touches any weak area above, break down the prerequisite intuition step-by-step and highlight common pitfalls.`);
        return parts.join('\n');
    }
    async applyMasteryDelta(params) {
        const filter = {
            user: new mongoose_2.Types.ObjectId(params.userId),
            course: new mongoose_2.Types.ObjectId(params.courseId),
            conceptKey: params.conceptKey,
        };
        const existing = await this.masteryModel.findOne(filter).exec();
        const prevScore = existing ? existing.masteryScore : 50;
        const nextScore = Math.max(5, Math.min(100, prevScore + params.delta));
        const nextStreak = params.correct ? (existing?.streak || 0) + 1 : 0;
        const recentMisses = existing ? [...(existing.recentMisses || [])] : [];
        if (params.missSnippet && !recentMisses.includes(params.missSnippet)) {
            recentMisses.push(params.missSnippet);
            while (recentMisses.length > 3)
                recentMisses.shift();
        }
        await this.masteryModel.findOneAndUpdate(filter, {
            $set: {
                label: params.label,
                masteryScore: nextScore,
                streak: nextStreak,
                recentMisses,
                lastReviewedAt: new Date(),
            },
            $inc: {
                attempts: 1,
                correctCount: params.correct ? 1 : 0,
            },
        }, { upsert: true });
    }
    cacheKey(userId, courseId) {
        return `rag:mastery:${userId}:${courseId}`;
    }
    async invalidateCache(userId, courseId) {
        await this.cache.del(this.cacheKey(userId, courseId)).catch(() => undefined);
    }
    titleCase(str) {
        return str
            .split(/\s+/)
            .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
            .join(' ')
            .trim();
    }
};
exports.MasteryService = MasteryService;
exports.MasteryService = MasteryService = MasteryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('user_masteries')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        cache_service_1.CacheService])
], MasteryService);
//# sourceMappingURL=mastery.service.js.map
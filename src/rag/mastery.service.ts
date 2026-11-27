import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserMasteryDocument } from '../schemas/user-mastery.schema';
import { CacheService } from '../cache/cache.service';

export interface MasteryConceptSummary {
  conceptKey: string;
  label: string;
  masteryScore: number;
  attempts: number;
  correctCount: number;
  streak: number;
  status: 'weak' | 'learning' | 'mastered';
  recentMisses: string[];
  lastReviewedAt: Date;
}

export interface LearnerMasteryProfile {
  courseId: string;
  userId: string;
  overallMastery: number;
  totalSignals: number;
  weakConcepts: MasteryConceptSummary[];
  learningConcepts: MasteryConceptSummary[];
  strongConcepts: MasteryConceptSummary[];
  allConcepts: MasteryConceptSummary[];
}

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
@Injectable()
export class MasteryService {
  private readonly logger = new Logger(MasteryService.name);

  constructor(
    @InjectModel('user_masteries')
    private readonly masteryModel: Model<UserMasteryDocument>,
    private readonly cache: CacheService,
  ) {}

  slugifyConcept(raw: string): string {
    return (raw || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);
  }

  /** Extract clean concept label(s) from a quiz prompt or flashcard */
  extractConceptsFromText(text: string, tags?: string[]): Array<{ key: string; label: string }> {
    const out: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();

    // Prefer explicit non-generic tags first
    for (const tag of tags || []) {
      const cleaned = (tag || '').trim();
      if (!cleaned || cleaned.toLowerCase() === 'ai-generated') continue;
      const key = this.slugifyConcept(cleaned);
      if (key.length >= 2 && !seen.has(key)) {
        seen.add(key);
        out.push({ key, label: this.titleCase(cleaned) });
      }
    }

    if (out.length > 0) return out.slice(0, 3);

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
    } else if (words.length === 1) {
      const key = this.slugifyConcept(words[0]);
      if (key.length >= 3) {
        return [{ key, label: this.titleCase(words[0]) }];
      }
    }

    return [{ key: 'general-concepts', label: 'Core Course Concepts' }];
  }

  /** Record mastery signals from every graded question in a Quiz or Exam submission */
  async recordQuizOutcome(
    userId: string,
    courseId: string,
    items: Array<{ prompt: string; correct: boolean }>,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(courseId) || !items.length) {
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
  async recordFlashcardOutcome(
    userId: string,
    courseId: string,
    card: { front?: string; tags?: string[] },
    difficulty: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(courseId)) {
      return;
    }

    const d = (difficulty || 'Good').toLowerCase();
    const deltaMap: Record<string, { delta: number; correct: boolean }> = {
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

  async getLearnerProfile(userId: string, courseId: string): Promise<LearnerMasteryProfile> {
    const cacheKey = this.cacheKey(userId, courseId);
    const cached = await this.cache.get<LearnerMasteryProfile>(cacheKey).catch(() => null);
    if (cached) return cached;

    const docs = await this.masteryModel
      .find({
        user: new Types.ObjectId(userId),
        course: new Types.ObjectId(courseId),
      })
      .sort({ masteryScore: 1 })
      .lean();

    const allConcepts: MasteryConceptSummary[] = docs.map((d: any) => {
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
    const overallMastery =
      allConcepts.length > 0
        ? Math.round(
            allConcepts.reduce((sum, c) => sum + c.masteryScore, 0) / allConcepts.length,
          )
        : 0;

    const profile: LearnerMasteryProfile = {
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
  buildAdaptiveDirective(profile: LearnerMasteryProfile): string {
    if (!profile || profile.totalSignals === 0) return '';

    const parts: string[] = [
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

    parts.push(
      `- When the question touches any weak area above, break down the prerequisite intuition step-by-step and highlight common pitfalls.`,
    );

    return parts.join('\n');
  }

  private async applyMasteryDelta(params: {
    userId: string;
    courseId: string;
    conceptKey: string;
    label: string;
    correct: boolean;
    delta: number;
    missSnippet?: string;
  }): Promise<void> {
    const filter = {
      user: new Types.ObjectId(params.userId),
      course: new Types.ObjectId(params.courseId),
      conceptKey: params.conceptKey,
    };

    const existing = await this.masteryModel.findOne(filter).exec();
    const prevScore = existing ? existing.masteryScore : 50;
    const nextScore = Math.max(5, Math.min(100, prevScore + params.delta));
    const nextStreak = params.correct ? (existing?.streak || 0) + 1 : 0;

    const recentMisses = existing ? [...(existing.recentMisses || [])] : [];
    if (params.missSnippet && !recentMisses.includes(params.missSnippet)) {
      recentMisses.push(params.missSnippet);
      while (recentMisses.length > 3) recentMisses.shift();
    }

    await this.masteryModel.findOneAndUpdate(
      filter,
      {
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
      },
      { upsert: true },
    );
  }

  private cacheKey(userId: string, courseId: string): string {
    return `rag:mastery:${userId}:${courseId}`;
  }

  private async invalidateCache(userId: string, courseId: string): Promise<void> {
    await this.cache.del(this.cacheKey(userId, courseId)).catch(() => undefined);
  }

  private titleCase(str: string): string {
    return str
      .split(/\s+/)
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''))
      .join(' ')
      .trim();
  }
}

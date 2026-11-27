import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { StudyArtifactDocument, StudyArtifactType } from '../schemas/study-artifact.schema';
import { LlmService } from '../common/llm.service';
import { SourcesService } from './sources.service';
import { MasteryService } from './mastery.service';

export type AudioOverviewStyle = 'deep_dive' | 'brief' | 'debate' | 'exam_cram';

export interface AudioDialogueTurn {
  speaker: 'Alex' | 'Sam';
  text: string;
  chapter?: string;
}

export interface AudioOverviewPayload {
  title: string;
  style: AudioOverviewStyle;
  chapters: string[];
  dialogue: AudioDialogueTurn[];
  sourceTitles: string[];
}

export interface ExamPredictorItem {
  topic: string;
  likelihood: 'very_high' | 'high' | 'medium';
  whyTestable: string;
  masteryGap: string;
  sampleQuestion: string;
  sourceTitles: string[];
}

/**
 * NotebookLM+ Study Studio Artifact Generator:
 * - 2-Host Audio Overviews (Alex & Sam podcast script with chapters, playable via free
 *   dual-voice browser TTS or optional server neural TTS).
 * - Mastery-Weighted High-Yield Exam Predictor.
 * - Persisted StudyArtifact history per course notebook.
 */
@Injectable()
export class StudioService {
  private readonly logger = new Logger(StudioService.name);

  constructor(
    @InjectModel('study_artifacts')
    private readonly artifactModel: Model<StudyArtifactDocument>,
    private readonly llm: LlmService,
    private readonly sourcesService: SourcesService,
    private readonly masteryService: MasteryService,
  ) {}

  async listArtifacts(courseId: string, artifactType?: StudyArtifactType) {
    const filter: any = { course: new Types.ObjectId(courseId) };
    if (artifactType) filter.artifactType = artifactType;

    const artifacts = await this.artifactModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return {
      success: true,
      data: { artifacts },
    };
  }

  async generateAudioOverview(
    courseId: string,
    userId: string,
    options: {
      style?: AudioOverviewStyle;
      focusTopic?: string;
      sourceIds?: string[];
    } = {},
  ) {
    const style: AudioOverviewStyle = options.style || 'deep_dive';
    const loaded = await this.sourcesService.getEnabledSourcesContent(
      courseId,
      options.sourceIds,
      40_000,
    );

    if (loaded.sources.length === 0 || !loaded.combinedMarkdown.trim()) {
      return {
        success: false,
        message: 'No active sources found. Enable at least one source first.',
      };
    }

    const profile = await this.masteryService.getLearnerProfile(userId, courseId);
    const weakNote =
      profile.weakConcepts.length > 0
        ? `Pay special attention to clarifying these tricky concepts the student missed recently: ${profile.weakConcepts
            .slice(0, 4)
            .map((c) => c.label)
            .join(', ')}.`
        : '';

    const styleGuidance: Record<AudioOverviewStyle, string> = {
      deep_dive: '12-16 natural conversational turns diving deep into intuition, examples, and connections.',
      brief: '7-9 crisp, high-signal conversational turns summarizing the essentials in ~2 minutes.',
      debate: '10-14 energetic turns where Alex and Sam debate perspectives, edge cases, and trade-offs.',
      exam_cram: '10-14 rapid-fire exam prep turns highlighting formulas, memory hooks, and common test traps.',
    };

    const focusClause = options.focusTopic?.trim()
      ? `Focus specifically on: "${options.focusTopic.trim()}".`
      : 'Cover the most important themes across all active sources.';

    const sourceTitles = loaded.sources.map((s) => s.title);
    const prompt = `Create an engaging 2-host educational podcast script (NotebookLM Audio Overview style) strictly grounded in the sources below.

Hosts:
- Alex: Warm, clear explainer who frames the big picture and intuitive analogies.
- Sam: Sharp, curious co-host who asks probing student questions, connects dots, and flags subtle exam traps.

Style (${style}): ${styleGuidance[style]}
${focusClause}
${weakNote}

Rules:
- Keep every turn natural for spoken audio (avoid raw markdown symbols or unreadable LaTeX syntax; speak equations naturally like "f prime of g of x times g prime of x").
- Group turns into 2-4 chapters.
- Return ONLY valid JSON (no markdown fences):
{
  "title": "Episode title",
  "chapters": ["Intro & Core Idea", "Key Mechanisms", "Exam Pitfalls"],
  "dialogue": [
    { "speaker": "Alex", "chapter": "Intro & Core Idea", "text": "..." },
    { "speaker": "Sam", "chapter": "Intro & Core Idea", "text": "..." }
  ]
}

Sources (${sourceTitles.join(', ')}):
${loaded.combinedMarkdown.slice(0, 32_000)}`;

    const completion = await this.llm.complete(
      [
        {
          role: 'system',
          content:
            'You are a world-class educational podcast producer. Return ONLY valid JSON matching the requested schema.',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.65, maxTokens: 3200, preferLongContext: true },
    );

    const parsed = this.parseJsonObject<AudioOverviewPayload>(completion.content);
    if (!parsed || !Array.isArray(parsed.dialogue) || parsed.dialogue.length === 0) {
      return {
        success: false,
        message: 'Failed to parse Audio Overview script from AI response. Please retry.',
      };
    }

    const dialogue: AudioDialogueTurn[] = parsed.dialogue
      .filter((t) => t && typeof t.text === 'string' && t.text.trim().length > 0)
      .map((t, idx) => ({
        speaker: t.speaker === 'Sam' ? 'Sam' : t.speaker === 'Alex' ? 'Alex' : idx % 2 === 0 ? 'Alex' : 'Sam',
        text: t.text.trim(),
        chapter: t.chapter || undefined,
      }));

    const totalWords = dialogue.reduce((acc, t) => acc + t.text.split(/\s+/).length, 0);
    const estimatedDurationSec = Math.max(30, Math.round((totalWords / 155) * 60));

    const payload: AudioOverviewPayload = {
      title: parsed.title || `Audio Overview (${style.replace('_', ' ')})`,
      style,
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
      dialogue,
      sourceTitles,
    };

    const saved = await this.artifactModel.create({
      course: new Types.ObjectId(courseId),
      createdBy: new Types.ObjectId(userId),
      artifactType: 'audio_overview',
      title: payload.title,
      subtitle: `${style.replace('_', ' ')} • ${dialogue.length} turns • ~${Math.ceil(estimatedDurationSec / 60)} min`,
      sourceIds: loaded.sources.map((s) => s.sourceId),
      payload,
      estimatedDurationSec,
    });

    return {
      success: true,
      message: 'Audio Overview generated',
      data: { artifact: saved },
    };
  }

  /**
   * High-Yield Exam Predictor:
   * Cross-references all active course sources with the learner's Mastery gaps to rank
   * the most testable topics and generate targeted sample exam questions.
   */
  async generateExamPredictor(
    courseId: string,
    userId: string,
    options: { sourceIds?: string[] } = {},
  ) {
    const loaded = await this.sourcesService.getEnabledSourcesContent(
      courseId,
      options.sourceIds,
      40_000,
    );

    if (loaded.sources.length === 0 || !loaded.combinedMarkdown.trim()) {
      return {
        success: false,
        message: 'No active sources found. Enable at least one source first.',
      };
    }

    const profile = await this.masteryService.getLearnerProfile(userId, courseId);
    const masterySummary =
      profile.allConcepts.length > 0
        ? `Student Mastery Profile (overall ${profile.overallMastery}%): Weak = [${profile.weakConcepts
            .map((c) => `${c.label}:${c.masteryScore}%`)
            .join(', ')}]; Strong = [${profile.strongConcepts
            .map((c) => `${c.label}:${c.masteryScore}%`)
            .join(', ')}].`
        : 'Student has not completed quizzes/flashcards yet.';

    const sourceTitles = loaded.sources.map((s) => s.title);
    const prompt = `Analyze the course study materials below and predict the 6-8 highest-yield exam topics.
Combine frequency/emphasis in the sources with the student's mastery gaps.

${masterySummary}

Return ONLY valid JSON (no markdown fences):
{
  "title": "High-Yield Exam Forecast",
  "readinessSummary": "1-2 sentence personalized exam readiness assessment",
  "highYieldTopics": [
    {
      "topic": "Chain Rule & Implicit Differentiation",
      "likelihood": "very_high",
      "whyTestable": "Core derivation appearing across multiple examples and formulas.",
      "masteryGap": "High priority — recent quiz misses on composite derivatives",
      "sampleQuestion": "Differentiate y = sin(x^2 + 3x) with respect to x.",
      "sourceTitles": ["calc101.pdf"]
    }
  ]
}

Sources (${sourceTitles.join(', ')}):
${loaded.combinedMarkdown.slice(0, 32_000)}`;

    const completion = await this.llm.complete(
      [
        {
          role: 'system',
          content: 'You are an expert professor & exam strategist. Return ONLY valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 2500, preferLongContext: true },
    );

    const parsed = this.parseJsonObject<{
      title?: string;
      readinessSummary?: string;
      highYieldTopics?: ExamPredictorItem[];
    }>(completion.content);

    if (!parsed || !Array.isArray(parsed.highYieldTopics) || parsed.highYieldTopics.length === 0) {
      return {
        success: false,
        message: 'Failed to generate exam predictor. Please try again.',
      };
    }

    const saved = await this.artifactModel.create({
      course: new Types.ObjectId(courseId),
      createdBy: new Types.ObjectId(userId),
      artifactType: 'exam_predictor',
      title: parsed.title || 'High-Yield Exam Forecast',
      subtitle: `${parsed.highYieldTopics.length} priority topics • Mastery ${profile.overallMastery}%`,
      sourceIds: loaded.sources.map((s) => s.sourceId),
      payload: {
        readinessSummary: parsed.readinessSummary || '',
        overallMastery: profile.overallMastery,
        highYieldTopics: parsed.highYieldTopics,
      },
    });

    return {
      success: true,
      message: 'Exam Predictor generated',
      data: { artifact: saved },
    };
  }

  private parseJsonObject<T>(raw: string): T | null {
    if (!raw) return null;
    const cleaned = raw.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '').trim();
    const startIdx = cleaned.indexOf('{');
    if (startIdx === -1) return null;

    let depth = 0;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === '{') depth++;
      else if (cleaned[i] === '}') depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(startIdx, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

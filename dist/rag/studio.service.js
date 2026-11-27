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
var StudioService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StudioService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const llm_service_1 = require("../common/llm.service");
const sources_service_1 = require("./sources.service");
const mastery_service_1 = require("./mastery.service");
/**
 * NotebookLM+ Study Studio Artifact Generator:
 * - 2-Host Audio Overviews (Alex & Sam podcast script with chapters, playable via free
 *   dual-voice browser TTS or optional server neural TTS).
 * - Mastery-Weighted High-Yield Exam Predictor.
 * - Persisted StudyArtifact history per course notebook.
 */
let StudioService = StudioService_1 = class StudioService {
    constructor(artifactModel, llm, sourcesService, masteryService) {
        this.artifactModel = artifactModel;
        this.llm = llm;
        this.sourcesService = sourcesService;
        this.masteryService = masteryService;
        this.logger = new common_1.Logger(StudioService_1.name);
    }
    async listArtifacts(courseId, artifactType) {
        const filter = { course: new mongoose_2.Types.ObjectId(courseId) };
        if (artifactType)
            filter.artifactType = artifactType;
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
    async generateAudioOverview(courseId, userId, options = {}) {
        const style = options.style || 'deep_dive';
        const loaded = await this.sourcesService.getEnabledSourcesContent(courseId, options.sourceIds, 40000);
        if (loaded.sources.length === 0 || !loaded.combinedMarkdown.trim()) {
            return {
                success: false,
                message: 'No active sources found. Enable at least one source first.',
            };
        }
        const profile = await this.masteryService.getLearnerProfile(userId, courseId);
        const weakNote = profile.weakConcepts.length > 0
            ? `Pay special attention to clarifying these tricky concepts the student missed recently: ${profile.weakConcepts
                .slice(0, 4)
                .map((c) => c.label)
                .join(', ')}.`
            : '';
        const styleGuidance = {
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
${loaded.combinedMarkdown.slice(0, 32000)}`;
        const completion = await this.llm.complete([
            {
                role: 'system',
                content: 'You are a world-class educational podcast producer. Return ONLY valid JSON matching the requested schema.',
            },
            { role: 'user', content: prompt },
        ], { temperature: 0.65, maxTokens: 3200, preferLongContext: true });
        const parsed = this.parseJsonObject(completion.content);
        if (!parsed || !Array.isArray(parsed.dialogue) || parsed.dialogue.length === 0) {
            return {
                success: false,
                message: 'Failed to parse Audio Overview script from AI response. Please retry.',
            };
        }
        const dialogue = parsed.dialogue
            .filter((t) => t && typeof t.text === 'string' && t.text.trim().length > 0)
            .map((t, idx) => ({
            speaker: t.speaker === 'Sam' ? 'Sam' : t.speaker === 'Alex' ? 'Alex' : idx % 2 === 0 ? 'Alex' : 'Sam',
            text: t.text.trim(),
            chapter: t.chapter || undefined,
        }));
        const totalWords = dialogue.reduce((acc, t) => acc + t.text.split(/\s+/).length, 0);
        const estimatedDurationSec = Math.max(30, Math.round((totalWords / 155) * 60));
        const payload = {
            title: parsed.title || `Audio Overview (${style.replace('_', ' ')})`,
            style,
            chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
            dialogue,
            sourceTitles,
        };
        const saved = await this.artifactModel.create({
            course: new mongoose_2.Types.ObjectId(courseId),
            createdBy: new mongoose_2.Types.ObjectId(userId),
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
    async generateExamPredictor(courseId, userId, options = {}) {
        const loaded = await this.sourcesService.getEnabledSourcesContent(courseId, options.sourceIds, 40000);
        if (loaded.sources.length === 0 || !loaded.combinedMarkdown.trim()) {
            return {
                success: false,
                message: 'No active sources found. Enable at least one source first.',
            };
        }
        const profile = await this.masteryService.getLearnerProfile(userId, courseId);
        const masterySummary = profile.allConcepts.length > 0
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
${loaded.combinedMarkdown.slice(0, 32000)}`;
        const completion = await this.llm.complete([
            {
                role: 'system',
                content: 'You are an expert professor & exam strategist. Return ONLY valid JSON.',
            },
            { role: 'user', content: prompt },
        ], { temperature: 0.3, maxTokens: 2500, preferLongContext: true });
        const parsed = this.parseJsonObject(completion.content);
        if (!parsed || !Array.isArray(parsed.highYieldTopics) || parsed.highYieldTopics.length === 0) {
            return {
                success: false,
                message: 'Failed to generate exam predictor. Please try again.',
            };
        }
        const saved = await this.artifactModel.create({
            course: new mongoose_2.Types.ObjectId(courseId),
            createdBy: new mongoose_2.Types.ObjectId(userId),
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
    parseJsonObject(raw) {
        if (!raw)
            return null;
        const cleaned = raw.replace(/```(?:json)?\n?/gi, '').replace(/```/g, '').trim();
        const startIdx = cleaned.indexOf('{');
        if (startIdx === -1)
            return null;
        let depth = 0;
        for (let i = startIdx; i < cleaned.length; i++) {
            if (cleaned[i] === '{')
                depth++;
            else if (cleaned[i] === '}')
                depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(cleaned.slice(startIdx, i + 1));
                }
                catch {
                    return null;
                }
            }
        }
        return null;
    }
};
exports.StudioService = StudioService;
exports.StudioService = StudioService = StudioService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('study_artifacts')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        llm_service_1.LlmService,
        sources_service_1.SourcesService,
        mastery_service_1.MasteryService])
], StudioService);
//# sourceMappingURL=studio.service.js.map
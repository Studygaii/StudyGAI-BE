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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlashcardService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const mongoose_3 = __importDefault(require("mongoose"));
const groq_service_1 = require("../common/groq.service");
const qdrant_service_1 = require("../qdrant/qdrant.service");
let FlashcardService = class FlashcardService {
    constructor(courseModel, // operate on courses
    groqService, // inject Groq service
    qdrantService) {
        this.courseModel = courseModel;
        this.groqService = groqService;
        this.qdrantService = qdrantService;
    }
    // Add flashcards to a course (bulk create)
    async create(body) {
        try {
            const course = await this.courseModel.findById(body.course);
            if (!course)
                return { status: 404, error: 'Course not found' };
            const newItems = (body.cards || []).map((c) => ({
                front: c.front || '',
                back: c.back || '',
                tags: c.tags || [],
                creator: new mongoose_3.default.Types.ObjectId(body.creator),
                easeFactor: typeof c.easeFactor === 'number' ? c.easeFactor : 2.5,
                interval: typeof c.interval === 'number' ? c.interval : 0,
                dueDate: c.dueDate || null,
                reviewCount: 0,
                lastReviewedAt: null,
                stats: {},
                createdAt: new Date(),
            }));
            course.flashcards = course.flashcards.concat(newItems);
            await course.save();
            return { message: 'success', flashcards: course.flashcards };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    // List flashcards for a course
    async list(courseID, userID) {
        try {
            const course = await this.courseModel.findById(courseID).select('flashcards title');
            if (!course)
                return { status: 404, error: 'Course not found' };
            return { message: 'success', courseId: courseID, title: course.title, flashcards: course.flashcards };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    // Get all flashcards for a course (compat with previous getById route where id was set id)
    async getById(courseId, userId) {
        try {
            const course = await this.courseModel.findById(courseId).select('flashcards title');
            if (!course)
                return { status: 404, error: 'Course not found' };
            return { message: 'success', courseId, title: course.title, flashcards: course.flashcards };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    // Replace or update a course's flashcards (partial update)
    async update(courseId, userId, body) {
        try {
            const course = await this.courseModel.findById(courseId);
            if (!course)
                return { status: 404, error: 'Course not found' };
            // Only creator can replace/modify all flashcards
            if (course.creator.toString() !== userId) {
                return { status: 403, error: 'Only course creator can update flashcards' };
            }
            if (body.cards && Array.isArray(body.cards)) {
                // replace flashcards array (mapping)
                course.flashcards = body.cards.map((c) => ({
                    front: c.front || '',
                    back: c.back || '',
                    tags: c.tags || [],
                    creator: new mongoose_3.default.Types.ObjectId(c.creator || userId),
                    easeFactor: typeof c.easeFactor === 'number' ? c.easeFactor : 2.5,
                    interval: typeof c.interval === 'number' ? c.interval : 0,
                    dueDate: c.dueDate || null,
                    reviewCount: c.reviewCount || 0,
                    lastReviewedAt: c.lastReviewedAt || null,
                    stats: c.stats || {},
                    createdAt: new Date(),
                }));
            }
            await course.save();
            return { message: 'Flashcards updated', flashcards: course.flashcards };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    // Review a card using simplified Anki-style ratings: 'Again'|'Hard'|'Good'|'Easy'
    async reviewCard(courseId, userId, cardIndex, rating) {
        try {
            const course = await this.courseModel.findById(courseId);
            if (!course)
                return { status: 404, error: 'Course not found' };
            if (!Array.isArray(course.flashcards) || cardIndex < 0 || cardIndex >= course.flashcards.length) {
                return { status: 400, error: 'Invalid card index' };
            }
            const card = course.flashcards[cardIndex];
            // Map rating to quality (0-5 roughly)
            const qualityMap = { 'Again': 0, 'Hard': 3, 'Good': 4, 'Easy': 5 };
            const q = qualityMap[rating] ?? 0;
            // Ensure defaults
            card.easeFactor = typeof card.easeFactor === 'number' ? card.easeFactor : 2.5;
            card.interval = typeof card.interval === 'number' ? card.interval : 0;
            // If failed (Again)
            if (q < 3) {
                card.interval = 1; // next day
                card.easeFactor = Math.max(1.3, card.easeFactor - 0.2);
            }
            else {
                // successful rep
                if (card.interval <= 0) {
                    card.interval = 1;
                }
                else {
                    // scale interval by EF; slight penalty for Hard
                    const factor = rating === 'Hard' ? Math.max(1.1, card.easeFactor - 0.1) : card.easeFactor;
                    card.interval = Math.max(1, Math.round(card.interval * factor));
                }
                // adjust easeFactor upwards for Good/Easy
                if (rating === 'Easy')
                    card.easeFactor = card.easeFactor + 0.15;
                if (rating === 'Good')
                    card.easeFactor = card.easeFactor + 0.05;
            }
            // dueDate = now + interval days
            const due = new Date();
            due.setDate(due.getDate() + (card.interval || 0));
            card.dueDate = due;
            // global counters
            card.reviewCount = (card.reviewCount || 0) + 1;
            card.lastReviewedAt = new Date();
            // per-user stats (track individualized progress)
            const uid = userId.toString();
            const prevStats = (card.stats && card.stats.get && card.stats.get(uid)) || null;
            const userStats = {
                reviewCount: (prevStats?.reviewCount || 0) + 1,
                lastReviewedAt: new Date(),
                interval: card.interval,
                easeFactor: card.easeFactor,
                dueDate: card.dueDate,
                lastRating: rating,
            };
            // if stats is a Map-like on doc, set via .set
            if (card.stats && typeof card.stats.set === 'function') {
                card.stats.set(uid, userStats);
            }
            else {
                // fallback: plain object
                card.stats = { ...(card.stats || {}), [uid]: userStats };
            }
            await course.save();
            return { message: 'Card reviewed', cardIndex, card };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    // Delete a specific card by courseId and index
    async delete(courseId, userId, cardIndexOrId) {
        try {
            const course = await this.courseModel.findById(courseId);
            if (!course)
                return { status: 404, error: 'Course not found' };
            // Only creator can remove cards
            if (course.creator.toString() !== userId) {
                return { status: 403, error: 'Only course creator can delete flashcards' };
            }
            if (typeof cardIndexOrId === 'number') {
                if (cardIndexOrId < 0 || cardIndexOrId >= course.flashcards.length) {
                    return { status: 400, error: 'Invalid card index' };
                }
                course.flashcards.splice(cardIndexOrId, 1);
            }
            else {
                // treat as ObjectId string and remove matching _id field if present
                course.flashcards = course.flashcards.filter((c) => {
                    return !(c._id && c._id.toString() === cardIndexOrId.toString());
                });
            }
            await course.save();
            return { message: 'Flashcard deleted', flashcards: course.flashcards };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    // Get flashcards due for a user (study mode)
    async getDueForUser(courseId, userId) {
        try {
            const course = await this.courseModel.findById(courseId).select('flashcards');
            if (!course)
                return { status: 404, error: 'Course not found' };
            const now = new Date();
            const due = (course.flashcards || []).filter((c) => {
                const userStats = (c.stats && c.stats.get && c.stats.get(userId)) || (c.stats && c.stats[userId]);
                if (userStats && userStats.dueDate) {
                    return new Date(userStats.dueDate) <= now;
                }
                // fallback: use card.dueDate
                return c.dueDate ? new Date(c.dueDate) <= now : true;
            });
            return { message: 'success', dueCount: due.length, due };
        }
        catch (error) {
            return { status: 500, error: error.message };
        }
    }
    /**
     * Generate flashcards from course PDF using Groq AI
     * Called when user requests "@studyGAI make flashcards on Chapter X"
     */
    async generateFromPDF(courseId, userId, topic) {
        try {
            const course = await this.courseModel.findById(courseId);
            if (!course)
                return { status: 404, error: 'Course not found' };
            // Only course creator or members can generate
            if (course.creator.toString() !== userId) {
                return { status: 403, error: 'Only course members can generate flashcards' };
            }
            // Check if PDF content exists
            if (!course.pdfContent || course.pdfContent.trim().length === 0) {
                return {
                    status: 400,
                    error: 'No PDF content found. Please upload a PDF to the course first.',
                };
            }
            console.log(`Generating flashcards for course: ${courseId}, topic: ${topic || 'all'}`);
            // Call Groq to generate flashcards
            const genResult = await this.groqService.generateFlashcardsFromPDF(course.pdfContent, course.title);
            if (genResult.status !== 200) {
                return genResult;
            }
            // Map generated cards to flashcard format with robust key handling
            const normalizeQA = (item) => {
                const pick = (keys) => {
                    for (const k of keys) {
                        if (item[k] && typeof item[k] === 'string' && item[k].trim().length > 0)
                            return item[k].trim();
                    }
                    return '';
                };
                // Common keys for front and back
                let front = pick(['front', 'question', 'q', 'prompt', 'term', 'query']);
                let back = pick(['back', 'answer', 'a', 'solution', 'explanation']);
                // If item has a combined text field, try to split on Q/A markers
                const combined = pick(['text', 'content', 'body']);
                if ((!front || !back) && combined) {
                    // Try patterns like "Q: ...\nA: ..." or "Question: ... Answer: ..."
                    const qaMatch = combined.match(/(?:Q(?:uestion)?[:\s-]*)([\s\S]*?)(?:\n|\r|\r\n)(?:A(?:nswer)?[:\s-]*)([\s\S]*)/i);
                    if (qaMatch) {
                        front = front || qaMatch[1].trim();
                        back = back || qaMatch[2].trim();
                    }
                    else {
                        // Try simple split on 'A:'
                        const idx = combined.search(/\nA[:\s-]/i);
                        if (idx !== -1) {
                            const parts = combined.split(/\nA[:\s-]/i);
                            front = front || parts[0].trim();
                            back = back || (parts[1] || '').trim();
                        }
                    }
                }
                // Final trimming
                front = (front || '').toString().trim();
                back = (back || '').toString().trim();
                return { front, back };
            };
            const newCards = [];
            const rawItems = Array.isArray(genResult.flashcards) ? genResult.flashcards : [];
            for (const item of rawItems) {
                const { front, back } = normalizeQA(item);
                if (!front || !back) {
                    console.warn('Skipping invalid AI flashcard item (missing front/back):', item);
                    continue;
                }
                newCards.push({
                    front,
                    back,
                    tags: item.tags || ['ai-generated'],
                    creator: new mongoose_3.default.Types.ObjectId(userId),
                    easeFactor: 2.5,
                    interval: 0,
                    dueDate: null,
                    reviewCount: 0,
                    lastReviewedAt: null,
                    stats: {},
                    createdAt: new Date(),
                });
            }
            if (newCards.length === 0) {
                console.error('No valid flashcards extracted from AI response. Raw items:', rawItems.slice(0, 5));
                return { status: 400, error: 'AI returned no valid flashcards. Try regenerating or check raw AI output.' };
            }
            // Add to course flashcards
            course.flashcards = course.flashcards.concat(newCards);
            await course.save();
            console.log(`Generated ${newCards.length} flashcards for course ${courseId}`);
            return {
                message: 'Flashcards generated and saved successfully',
                count: newCards.length,
                flashcards: newCards,
                courseId,
            };
        }
        catch (error) {
            console.error('Flashcard generation error:', error);
            return { status: 500, error: error.message };
        }
    }
};
exports.FlashcardService = FlashcardService;
exports.FlashcardService = FlashcardService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)('courses')),
    __metadata("design:paramtypes", [mongoose_2.Model,
        groq_service_1.GroqService,
        qdrant_service_1.QdrantService])
], FlashcardService);
//# sourceMappingURL=flashcard.service.js.map
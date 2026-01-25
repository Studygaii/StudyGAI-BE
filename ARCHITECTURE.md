# QubeChat - Complete Architecture Documentation (Updated)

## Overview of major updates
- **AI-Powered Flashcard Generation**: Groq AI analyzes uploaded PDFs and auto-generates high-quality flashcards (front/back pairs) on-demand
- Flashcards are embedded directly on the Course document (course.flashcards[]). This simplifies sharing (course-level visibility), group study and per-user tracking.
- Flashcard review uses Anki-style spaced repetition with ratings: Again / Hard / Good / Easy. Each card stores easeFactor, interval (days), dueDate and per-user stats.
- Group chats enforce a maximum of 5 members. Creator is always included and members are deduplicated; service-level validation prevents oversize groups.
- WebSocket gateway was hardened: JWT required on connect, userSockets and activeRooms tracked, clean removal from rooms on disconnect, and safety checks to avoid crashes on missing data.
- ChatModule and other module imports were fixed (Mongoose forFeature array syntax), and the separate flashcards collection was removed (flashcards now live on Course).

---

## AI-Powered Flashcard Generation

### Flow: "@studyGAI make flashcards on Chapter X"

1. **User uploads PDF** → `POST /api/v1/upload/doc` with courseId
   - UploadService detects PDF and calls PdfService.processPdfForCourse()
   - PdfService extracts text and saves to course.pdfContent

2. **User requests flashcard generation** → `POST /api/v1/flashcards/:courseId/generate-from-pdf`
   - FlashcardService retrieves course.pdfContent
   - Calls GroqService.generateFlashcardsFromPDF(pdfContent)

3. **Groq AI generates flashcards**
   - Analyzes PDF text for key concepts
   - Generates 10-15 front/back pairs
   - Assigns relevant tags
   - Returns JSON with flashcard array

4. **Flashcards saved to course**
   - FlashcardService maps generated cards to embed format
   - Adds to course.flashcards[]
   - Cards ready for study (interval = 0, due immediately)

### GroqService.generateFlashcardsFromPDF()

- Truncates large PDFs (400k chars ≈ 100k tokens, within model limits)
- Uses system prompt: "Expert educator creating study flashcards"
- Temperature: 0.7 (balance creativity and consistency)
- Returns strict JSON: `{ flashcards: [{ front, back, tags }, ...] }`
- Handles parse errors gracefully

### Benefits

- **Instant study materials** from any PDF
- **Consistent quality** via AI instructor
- **Customizable** per topic/chapter
- **Scalable** to large courses
- **Combines with manual** flashcards (user can add/edit)

---

## Data model updates

### Course document (flashcards embedded)
Each course now contains a flashcards array with the following important fields:

- front (String) — card front (question)
- back (String) — card back (answer)
- tags [String]
- creator (ObjectId)
- easeFactor (Number, default 2.5)
- interval (Number, days)
- dueDate (Date)
- reviewCount (Number)
- lastReviewedAt (Date)
- stats (Map) — per-user stat objects:
  - reviewCount, lastReviewedAt, interval, easeFactor, dueDate, lastRating

Benefits:
- Easy sharing across course members and group chats.
- Centralized storage means group quizzes and exports are simpler.
- Per-user stats allow personalized scheduling and reminders.
- AI can generate cards directly onto course (no separate model).

---

## Flashcard service & review flow

- FlashcardService now operates on the Course model (Mongoose `courses` document).
- Key operations:
  - create: bulk-add cards to course.flashcards[]
  - generateFromPDF: AI-powered generation from course PDF
  - list/get: return course flashcards
  - reviewCard: accept rating ('Again'|'Hard'|'Good'|'Easy'), update card.interval and easeFactor, set dueDate, increment counters and update per-user stats
  - getDueForUser: returns cards due for a given user
  - delete/update: course creator only
- Simplified scheduling rules implemented:
  - 'Again' → interval = 1 day, EF -= 0.2 (min 1.3)
  - 'Hard' → smaller growth, slightly reduce EF for next interval
  - 'Good' / 'Easy' → increase EF slightly, multiply interval by EF
  - dueDate = now + interval days
- Mastery and set status logic is computed from per-card stats (previous logic preserved where applicable, but sets live on course now).

---

## Group chat rules

- Maximum members per group: 5 (enforced in GroupChatService)
- Creator is automatically included and cannot be removed by non-creator operations
- Members are deduplicated
- Only creator can delete/update the group chat
- Endpoints unchanged, but service returns 400 when attempting to exceed member limit

---

## WebSocket gateway

- Authentication:
  - Clients must provide JWT in handshake (auth.token)
  - Server verifies token; unauthenticated sockets disconnected
- Runtime state:
  - userSockets: Map<userId, Set<socketId>>
  - activeRooms: Map<roomId, Set<userId>>
- Events:
  - join-room: adds userId to room, emits user-joined with activeUsers list
  - leave-room / disconnect: removes user from room(s), emits user-left
  - send-message: broadcasts and optionally persists to DB
  - send-ai-message / send-ai-stream: integrated with GroqService; stream handling sends ai-stream-chunk and ai-stream-done
- Multi-instance note: use Redis adapter when scaling across servers.

---

## Module & wiring changes

- ChatModule: fixed forFeature array and imports (chats, courses, groupchats schemas included correctly).
- FlashcardModule: now registers the Course schema and operates on courses model instead of a separate flashcards collection. Imports GroqModule for AI generation.
- AppModule: removed separate Flashcard schema registration; Course schema exposes embedded flashcards.
- PdfService / UploadService: unchanged interface; upload triggers PDF processing which saves pdfContent on course (unchanged).

---

## API changes / compatibility notes

- Flashcard endpoints now treat the courseId as the primary identifier for flashcard storage:
  - POST /api/v1/flashcards/create — adds cards into course.flashcards[]
  - POST /api/v1/flashcards/:courseId/generate-from-pdf — **NEW** AI generates and saves cards
  - GET /api/v1/flashcards/list/:courseID — lists course.flashcards
  - POST /api/v1/flashcards/:courseId/review — review by courseId + cardIndex
  - DELETE /api/v1/flashcards/:courseId/:cardIndexOrId — delete card (course creator only)
  - GET /api/v1/flashcards/due/:courseId/:userId — returns due cards for user
- Clients must adapt to cardIndex-based review or supply card unique id if implemented.
- Group chat endpoints remain the same but may return 400 on member-limit violations.

---

## Real-time study & group quizzes

- With flashcards on Course, SAGE can:
  - Run live group quizzes by broadcasting due cards to room members.
  - Collect and store per-user responses (update per-user stats).
  - Provide leaderboards and per-user progress in real time.
  - Auto-generate cards from course PDFs for instant study materials.

---

## Next steps / recommendations

- Implement chunking/embedding + RAG for large PDFs instead of passing full pdfContent as system message.
- Add scheduled job to notify users of due cards (proactive reminders).
- Add unit/integration tests for review algorithm, group-member constraints, and AI generation.
- Add Redis adapter for socket.io when scaling to multiple instances.
- Add endpoints to export course.flashcards to Anki (.apkg) or CSV.
- Implement feedback loop: users rate AI-generated cards, refine prompt over time.

---

End of updated architecture notes.


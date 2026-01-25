# SAGE-BE Complete Architecture & Data Flow

> **⚠️ UPDATE (Post-Cleanup)**: As of the recent code cleanup, the NestJS EmbeddingsModule has been removed. All embedding generation is now handled exclusively by the Python Docling microservice. See [CLEANUP_SUMMARY.md](CLEANUP_SUMMARY.md) for details.

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER / FRONTEND                                   │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────────┐
        │                            │                                │
        ▼                            ▼                                ▼
   ┌─────────────┐          ┌──────────────────┐          ┌──────────────────┐
   │ PDF Upload  │          │ Chat Message     │          │ Flashcard Gen    │
   │ POST /upload│          │ @studyGAI prompt │          │ POST /generate   │
   └──────┬──────┘          └────────┬─────────┘          └────────┬─────────┘
          │                          │                             │
          ▼                          ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        NestJS BACKEND (Port 4000)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ Upload Service   │  │ Chat Service     │  │ Flashcard Service        │  │
│  │                  │  │                  │  │                          │  │
│  │ 1. Validate file │  │ 1. Check for     │  │ 1. Get course PDF        │  │
│  │ 2. Save to disk  │  │    @studyGAI     │  │ 2. Call Groq API         │  │
│  │ 3. Call Docling  │  │ 2. Query Qdrant  │  │ 3. Generate cards        │  │
│  │    service       │  │ 3. Inject context│  │ 4. Save to MongoDB       │  │
│  │ 4. Store result  │  │ 4. Call Groq LLM │  │ 5. (Optional: Index in   │  │
│  │    in MongoDB    │  │ 5. Return answer │  │     Qdrant for search)   │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
│         │                       │                        │                  │
│         │                       │                        │                  │
└─────────┼───────────────────────┼────────────────────────┼──────────────────┘
          │                       │                        │
          ▼                       ▼                        ▼
     ┌─────────────────────────────────────────────────────────┐
     │           QDRANT SERVICE (Port 6333)                   │
     │        Vector Database / Semantic Search               │
     ├─────────────────────────────────────────────────────────┤
     │                                                         │
     │  Collection: pdf_chunks                                │
     │  ┌──────────────────────────────────────────────────┐  │
     │  │ Point (Vector + Metadata)                        │  │
     │  │ ┌────────────────────────────────────────────┐   │  │
     │  │ │ Vector: [0.23, -0.45, 0.67, ...] (384 dim)│   │  │
     │  │ │ Payload:                                   │   │  │
     │  │ │  - course_id: "course_123"                │   │  │
     │  │ │  - text: "Chapter content..."             │   │  │
     │  │ │  - chunk_index: 5                         │   │  │
     │  │ │  - metadata: {source: "pdf", ...}         │   │  │
     │  │ └────────────────────────────────────────────┘   │  │
     │  │                                                  │  │
     │  │ [Millions of points indexed for fast search]     │  │
     │  └──────────────────────────────────────────────────┘  │
     │                                                         │
     └─────────────────────────────────────────────────────────┘
          │                       │
          ▼                       ▼
     ┌──────────────────────────────────────────┐
     │  PYTHON DOCLING SERVICE (Port 5000)     │
     │  Advanced PDF Processing                │
     ├──────────────────────────────────────────┤
     │                                          │
     │ 1. Extract text (preserves structure)   │
     │ 2. Extract formulas (LaTeX)             │
     │ 3. Extract images (with captions)       │
     │ 4. Generate embeddings                  │
     │    (Sentence-Transformers 384-dim)      │
     │ 5. Store in Qdrant                      │
     │                                          │
     └──────────────────────────────────────────┘
          │
          ▼
     ┌──────────────────────────────────────────┐
     │  MONGODB (Port 27017)                   │
     │  Persistent Data Storage                │
     ├──────────────────────────────────────────┤
     │                                          │
     │ Collections:                            │
     │  - courses                              │
     │    {                                    │
     │      _id: ObjectId,                    │
     │      title: "Math 101",                │
     │      pdfContent: "raw text...",        │
     │      flashcards: [...],                │
     │      creator: userId,                  │
     │    }                                    │
     │                                          │
     │  - chats                                │
     │  - users                                │
     │  - groupchats                           │
     │  - quizzes                              │
     │                                          │
     └──────────────────────────────────────────┘
          │
          ▼
     ┌──────────────────────────────────────────┐
     │  GROQ API (Cloud)                       │
     │  LLM (Large Language Model)             │
     ├──────────────────────────────────────────┤
     │                                          │
     │ Receives:                               │
     │  - User query                           │
     │  - Context chunks from Qdrant           │
     │  - System prompt                        │
     │                                          │
     │ Returns:                                │
     │  - AI response (text or streaming)      │
     │  - Generated flashcards (JSON)          │
     │                                          │
     └──────────────────────────────────────────┘
```

---

## Complete Data Flow: Step by Step

### 🔄 FLOW 1: PDF UPLOAD & EMBEDDING

```
User Action: Upload PDF to Course
│
├─► POST /api/v1/upload/doc?courseId=123
│
├─► UploadService.uploadDoc()
│   ├─► Save file to disk
│   └─► Call PdfService.processFileForCourse()
│
├─► PdfService.processFileForCourse()
│   ├─► Extract text (pdf-parse)
│   └─► Save to MongoDB: course.pdfContent = "extracted text..."
│
├─► UploadService.triggerPDFEmbedding()
│   └─► Send file to Docling service (HTTP POST)
│
├─► DOCLING SERVICE: POST /embed-pdf?course_id=123
│   ├─► Convert PDF using DocumentConverter
│   │   ├─► Extract text with structure preserved
│   │   ├─► Extract formulas (LaTeX)
│   │   └─► Extract images (metadata + captions)
│   │
│   ├─► Prepare text with formula context
│   │   └─► "Chapter text... ### Formulas: ∫dx... ### Images: Figure 1..."
│   │
│   ├─► Generate embeddings (Sentence-Transformers)
│   │   ├─► Chunk text (512 chars, 100 char overlap)
│   │   ├─► Create 384-dimensional vectors for each chunk
│   │   └─► Each vector captures semantic meaning
│   │
│   ├─► Store in Qdrant
│   │   ├─► Create point with:
│   │   │   ├─► Vector: [0.234, -0.456, ...] (384 dims)
│   │   │   ├─► Payload: {
│   │   │   │     course_id: "123",
│   │   │   │     text: "chunk content",
│   │   │   │     chunk_index: 0,
│   │   │   │     metadata: {...}
│   │   │   │   }
│   │   │   └─► Store in "pdf_chunks" collection
│   │   │
│   │   └─► Return embedding_stats to frontend
│
└─► SUCCESS: PDF indexed in Qdrant, searchable!
```

**Result in Qdrant:**
- 50 PDF pages → ~100 chunks (with overlap)
- 100 vectors stored with metadata
- Indexed for fast similarity search
- Ready for retrieval

---

### 💬 FLOW 2: USER SENDS @studyGAI MESSAGE

```
User Action: Send chat message "@studyGAI What is calculus?"
│
├─► POST /api/v1/chats/send?courseId=123
│   Body: {
│     messages: [
│       { role: "user", content: "@studyGAI What is calculus?" }
│     ]
│   }
│
├─► ChatService.sendWithContext()
│   ├─► Detect @studyGAI mention ✓
│   │
│   ├─► Extract query: "What is calculus?"
│   │
│   └─► Call ChatService.getStudyGAIContext()
│       │
│       └─► QdrantService.searchSimilarChunks()
│           ├─► Generate embedding for query "What is calculus?"
│           │   └─► Query vector: [0.121, -0.334, ...] (384 dims)
│           │
│           ├─► Similarity search in Qdrant
│           │   ├─► Compare query vector with all 100 stored vectors
│           │   ├─► Calculate cosine similarity
│           │   ├─► Sort by score (highest = most relevant)
│           │   └─► Return top 3-5 results
│           │
│           └─► Results:
│               [
│                 {
│                   score: 0.87,  ← Very similar!
│                   text: "Calculus is the mathematical study of change...",
│                   chunk_index: 5,
│                   metadata: {...}
│                 },
│                 {
│                   score: 0.72,
│                   text: "Derivatives measure rates of change...",
│                   chunk_index: 12,
│                   metadata: {...}
│                 },
│                 ...
│               ]
│
├─► Inject context into message
│   Messages become:
│   {
│     role: "user",
│     content: "@studyGAI What is calculus?
│               
│               --- Context from course materials ---
│               [Relevant Context 1]
│               Calculus is the mathematical study of change...
│               
│               [Relevant Context 2]
│               Derivatives measure rates of change...
│               "
│   }
│
├─► Call GroqService.getGroqChatCompletion(enriched_messages)
│   ├─► Send to Groq API with context
│   │
│   └─► Groq LLM processes:
│       {
│         system: "You are an expert educator...",
│         messages: [{
│           role: "user",
│           content: "...@studyGAI What is calculus?
│                      
│                      --- Context from course materials ---
│                      [Relevant chunks]"
│         }]
│       }
│
├─► Groq generates answer USING the context
│   └─► "Based on your course materials, calculus is...
│         As stated in your notes, derivatives..."
│
└─► Return answer to user with course-specific knowledge!
```

**Key Point:** The model is **NOT** generating from scratch. It's using your course materials as ground truth!

---

### 📚 FLOW 3: FLASHCARD GENERATION FROM PDF

```
User Action: Request flashcard generation
│
├─► POST /api/v1/flashcards/:courseId/generate-from-pdf
│
├─► FlashcardService.generateFromPDF()
│   ├─► Get course from MongoDB
│   ├─► Get course.pdfContent (raw extracted text)
│   │
│   ├─► Call GroqService.generateFlashcardsFromPDF()
│   │   └─► Send to Groq:
│   │       {
│   │         system: "Expert educator creating study flashcards",
│   │         user_message: "[full PDF text from course]"
│   │       }
│   │
│   ├─► Groq generates flashcard JSON
│   │   [
│   │     {
│   │       front: "What is the derivative?",
│   │       back: "A measure of instantaneous rate of change",
│   │       tags: ["calculus", "derivatives"]
│   │     },
│   │     ...
│   │   ]
│   │
│   ├─► Save to MongoDB: course.flashcards = [...]
│   │
│   └─► (Optional Future) Index flashcards in Qdrant
│       └─► Enable "Find similar flashcards" feature
│
└─► Flashcards ready for study!
```

---

## Data Storage Breakdown

### MongoDB (Persistent Data)

```
Database: SAGE

Collections:

1. courses
   {
     _id: ObjectId,
     title: "Calculus 101",
     pdfContent: "full text extracted from PDF...",  ← Raw text
     creator: userId,
     flashcards: [                                   ← Generated flashcards
       {
         front: "What is a derivative?",
         back: "Rate of change...",
         tags: ["calculus"],
         easeFactor: 2.5,
         interval: 0,
         dueDate: Date,
         stats: {userId: {...}}
       }
     ],
     createdAt: Date
   }

2. chats
   {
     _id: ObjectId,
     title: "Calculus Discussion",
     course: courseId,
     creator: userId,
     messages: [
       {
         role: "user",
         content: "@studyGAI...",
         timestamp: Date
       },
       {
         role: "assistant",
         content: "Based on course materials...",
         timestamp: Date
       }
     ]
   }

3. users
   {
     _id: ObjectId,
     email: "user@example.com",
     password: "hashed...",
     name: "John Doe"
   }
```

### Qdrant (Vector Search)

```
Collection: pdf_chunks

Structure:
{
  id: "unique-uuid",
  vector: [0.234, -0.456, 0.678, ...],  ← 384 dimensions
  payload: {
    course_id: "course_123",             ← Filter by course
    chunk_index: 5,                      ← Position in doc
    text: "Calculus is...",              ← Searchable content
    chunk_count: 100,                    ← Total chunks
    metadata: {
      source: "pdf",
      page_number: 3,
      formula_count: 2,
      image_count: 1
    }
  }
}

Total stored: 100 chunks × 384 dimensions × 4 bytes = ~150KB per course
```

---

## Key Technologies & Their Roles

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Backend API** | NestJS + Express | Handle requests, orchestrate services |
| **Document Processing** | Docling + Sentence-Transformers | Extract text, formulas, images, generate embeddings |
| **Vector DB** | Qdrant | Store and search embeddings |
| **Persistent DB** | MongoDB | Store courses, chats, flashcards, users |
| **LLM** | Groq API | Generate answers, create flashcards |
| **Cache** | Redis | Cache frequently accessed data |
| **Message Broker** | WebSocket / Socket.io | Real-time chat |

---

## Query Flow Summary

```
User Question: "@studyGAI What is calculus?"
        │
        ├─► Question Embedding (Sentence-Transformers)
        │   └─► [0.121, -0.334, 0.567, ...] (384-dim)
        │
        ├─► Similarity Search (Qdrant HNSW index)
        │   └─► Find top-k similar chunks from 100 vectors
        │       (O(log n) time complexity due to indexing)
        │
        ├─► Retrieve Context (MongoDB link via payload)
        │   └─► Get actual text: "Calculus is the study..."
        │
        ├─► Inject into Prompt
        │   {
        │     system: "...",
        │     user: "Question + [Context Chunk 1] + [Context Chunk 2]..."
        │   }
        │
        └─► LLM Response (Groq)
            └─► "Based on your course: Calculus is..."
```

---

## Why This Architecture?

✅ **Fast** - Qdrant provides O(log n) search vs O(n) full text
✅ **Semantic** - Vectors understand meaning, not just keywords
✅ **Scalable** - Can handle 1000+ PDFs with millions of chunks
✅ **Accurate** - Uses course content as ground truth, not hallucinations
✅ **Flexible** - Easy to add new data sources, features
✅ **Persistent** - MongoDB keeps everything, Qdrant caches for speed

---

## Example: Full Student Workflow

```
1. Teacher uploads "Calculus_101.pdf" (50 pages, 1MB)
   └─► Extracted, embedded, stored in Qdrant (100 chunks)

2. Student asks: "@studyGAI Explain the chain rule"
   └─► System finds 3 relevant chunks from PDF
   └─► Groq synthesizes answer using those chunks
   └─► Student gets accurate, course-specific answer

3. Student requests: "Generate flashcards"
   └─► Groq reads entire PDF
   └─► Generates 20 flashcards
   └─► Stored in MongoDB for study

4. Student reviews flashcards (spaced repetition)
   └─► System tracks ease factor
   └─► Adjusts next review date

5. Teacher analyzes: Which topics struggle students?
   └─► Check quiz performance, flashcard ease factors
   └─► Plan next lesson accordingly
```

---

## Storage Requirements

```
Per 50-page PDF:
├─► Raw PDF: 1-5 MB
├─► Extracted text in MongoDB: 200-500 KB
├─► Vectors in Qdrant: 
│   ├─► 100 chunks
│   ├─► 384 dimensions each
│   ├─► ~4 bytes per dimension
│   └─► Total: ~156 KB
└─► Generated flashcards: ~50 KB

TOTAL PER PDF: ~600 KB - 1.5 MB in storage
              ~156 KB actively indexed for search

10 courses: ~1.5-15 MB total
100 courses: ~15-150 MB total
```

**Very efficient! 🚀**

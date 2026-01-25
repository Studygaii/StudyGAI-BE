# SAGE Backend - Test Data & API Examples

This document provides comprehensive curl examples and test data for all SAGE API endpoints.

## Prerequisites

1. Start the dev server:
```bash
npm run start:dev
```

2. Server runs on `http://localhost:4000`
3. Swagger docs available at `http://localhost:4000/docs`
4. All protected endpoints require a JWT token in the Authorization header

---

## Authentication

### Register User

**Endpoint:** `POST /api/v1/auth/register`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student1@example.com",
    "username": "student1",
    "password": "password123"
  }'
```

**Response:**
```json
{
  "reply": "Success",
  "token": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "student1",
    "email": "student1@example.com",
    "avatar": "http://localhost:4000/images/user_placeholder.png"
  }
}
```

**Save token for later use:**
```bash
export JWT_TOKEN="Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Login User

**Endpoint:** `POST /api/v1/auth/login`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student1@example.com",
    "password": "password123"
  }'
```

**Response:**
```json
{
  "reply": "Success",
  "token": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "username": "student1",
    "email": "student1@example.com",
    "avatar": "http://localhost:4000/images/user_placeholder.png"
  }
}
```

### Login with Google OAuth

**Endpoint (Browser Flow):** `GET /api/v1/auth/google`

**What happens:**
1. Redirect browser to `/api/v1/auth/google`
2. User logs in with their Google account
3. Backend creates or updates user (using googleId)
4. Browser redirected to `FRONTEND_URL#token=Bearer...` with JWT

**Test (Browser):**
```
http://localhost:4000/api/v1/auth/google
```

**Callback Endpoint:** `GET /api/v1/auth/google/redirect`
- Server-side: authenticates and returns user + JWT
- Browser: redirects with token fragment for frontend to read

**Required env variables:**
```bash
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/v1/auth/google/redirect
FRONTEND_URL=http://localhost:3000  # Optional, for browser redirect
```

**Google Setup Instructions:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials (Web application)
3. Add authorized redirect URIs: `http://localhost:4000/api/v1/auth/google/redirect`
4. Copy Client ID and Client Secret to `.env`
5. Restart backend: `npm run start:dev`

---

## Course Management

### Create Course

**Endpoint:** `POST /api/v1/course/new`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/course/new \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Advanced React 2024",
    "description": "Learn modern React with hooks, context, and performance optimization",
    "creator": "507f1f77bcf86cd799439011"
  }'
```

**Response:**
```json
{
  "message": "success",
  "course": {
    "_id": "507f1f77bcf86cd799439012",
    "title": "Advanced React 2024",
    "description": "Learn modern React with hooks, context, and performance optimization",
    "creator": "507f1f77bcf86cd799439011",
    "chats": [],
    "files": [],
    "pdfProcessed": false,
    "flashcards": [],
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### List Courses

**Endpoint:** `GET /api/v1/course/list`

**Test Data:**
```bash
curl -X GET http://localhost:4000/api/v1/course/list \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "courses": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "title": "Advanced React 2024",
      "description": "Learn modern React...",
      "creator": "507f1f77bcf86cd799439011",
      "pdfProcessed": false,
      "flashcards": [],
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Delete Course

**Endpoint:** `DELETE /api/v1/course/delete/:id`

**Test Data:**
```bash
curl -X DELETE http://localhost:4000/api/v1/course/delete/507f1f77bcf86cd799439012 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "id": "507f1f77bcf86cd799439012"
}
```

---

## File Upload & Multi-Format Processing (PDF, DOCX, TXT, XLSX, etc.)

### Upload Document (Any Format)

**Endpoint:** `POST /api/v1/upload/doc`

**Supported formats:**
- PDF (via llama-parse or pdf-parse fallback)
- DOCX (via llama-parse)
- TXT
- XLSX (via llama-parse)
- PPTX (via llama-parse)
- Images (JPG, PNG via llama-parse)
- And many others supported by llama-parse

**How it works:**
- With `courseId`: backend extracts text from ANY file using `llama-parse` (if available) or falls back to pdf-parse for PDFs or UTF-8 text
- Without `courseId`: files are just stored, no processing

**Test Data (with courseId for auto parsing - any file type):**
```bash
# Upload PDF
curl -X POST http://localhost:4000/api/v1/upload/doc \
  -H "Authorization: $JWT_TOKEN" \
  -F "files=@./course-material.pdf" \
  -F "courseId=507f1f77bcf86cd799439012"

# Upload DOCX
curl -X POST http://localhost:4000/api/v1/upload/doc \
  -H "Authorization: $JWT_TOKEN" \
  -F "files=@./lecture-notes.docx" \
  -F "courseId=507f1f77bcf86cd799439012"

# Upload TXT
curl -X POST http://localhost:4000/api/v1/upload/doc \
  -H "Authorization: $JWT_TOKEN" \
  -F "files=@./summary.txt" \
  -F "courseId=507f1f77bcf86cd799439012"

# Upload multiple files (first is processed, rest stored)
curl -X POST http://localhost:4000/api/v1/upload/doc \
  -H "Authorization: $JWT_TOKEN" \
  -F "files=@./main.pdf" \
  -F "files=@./appendix.docx" \
  -F "courseId=507f1f77bcf86cd799439012"
```

**Test Data (without courseId - no processing):**
```bash
curl -X POST http://localhost:4000/api/v1/upload/doc \
  -H "Authorization: $JWT_TOKEN" \
  -F "files=@./sample.pdf" \
  -F "files=@./notes.docx"
```

**Response (with file processing via llama-parse/fallback):**
```json
{
  "message": "File uploaded and processed successfully",
  "files": [
    {
      "path": "/uploads/files-1705321800000-123456789.pdf",
      "name": "course-material.pdf"
    }
  ],
  "processing": {
    "message": "PDF processed successfully",
    "courseId": "507f1f77bcf86cd799439012",
    "textLength": 12543,
    "preview": "Chapter 1: Introduction to React Hooks...[...]"
  }
}
```

**Response (no courseId):**
```json
{
  "message": "File uploaded successfully",
  "files": ["/uploads/files-1705321800000-123456789.pdf"],
  "note": "To process file for a course, include courseId in the request"
}
```

**Response (processing failed with fallback info):**
```json
{
  "message": "File uploaded but processing failed",
  "files": [{"path": "/uploads/...", "name": "file.ext"}],
  "error": "Unsupported file type and no parser available"
}
```

### Get PDF Content

**Endpoint:** `GET /api/v1/pdf/content/:courseId`

**Test Data:**
```bash
curl -X GET http://localhost:4000/api/v1/pdf/content/507f1f77bcf86cd799439012 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "courseId": "507f1f77bcf86cd799439012",
  "contentLength": 12543,
  "preview": "Chapter 1: Introduction to React Hooks\n\nHooks are a new addition to React that let you use state without writing a class..."
}
```

---

## Chat Endpoints

### Create Chat

**Endpoint:** `POST /api/v1/chat/new`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/chat/new \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "React Hooks Discussion",
    "creator": "507f1f77bcf86cd799439011",
    "course": "507f1f77bcf86cd799439012"
  }'
```

**Response:**
```json
{
  "message": "success",
  "chat": {
    "_id": "507f1f77bcf86cd799439020",
    "title": "React Hooks Discussion",
    "creator": "507f1f77bcf86cd799439011",
    "course": "507f1f77bcf86cd799439012",
    "messages": [],
    "createdAt": "2024-01-15T10:35:00Z"
  }
}
```

### List Chats for Course

**Endpoint:** `GET /api/v1/chat/list/:courseID`

**Test Data:**
```bash
curl -X GET http://localhost:4000/api/v1/chat/list/507f1f77bcf86cd799439012 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "chats": [
    {
      "_id": "507f1f77bcf86cd799439020",
      "title": "React Hooks Discussion",
      "creator": "507f1f77bcf86cd799439011",
      "course": "507f1f77bcf86cd799439012",
      "messages": [],
      "createdAt": "2024-01-15T10:35:00Z"
    }
  ]
}
```

### Send Message to AI

**Endpoint:** `POST /api/v1/chat/send`

**Test Data (without PDF context):**
```bash
curl -X POST http://localhost:4000/api/v1/chat/send \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What are React Hooks?"
      }
    ]
  }'
```

**Test Data (with PDF context):**
```bash
curl -X POST http://localhost:4000/api/v1/chat/send \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Explain the useEffect hook based on the course material"
      }
    ],
    "courseId": "507f1f77bcf86cd799439012"
  }'
```

**Response:**
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "React Hooks are functions that let you 'hook into' React features from function components. The main hooks are:\n\n1. useState - Manage state in functional components\n2. useEffect - Handle side effects\n3. useContext - Access context values..."
      }
    }
  ]
}
```

### Stream AI Response

**Endpoint:** `POST /api/v1/chat/send-stream`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/chat/send-stream \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What is state management in React?"
      }
    ],
    "courseId": "507f1f77bcf86cd799439012"
  }'
```

**Response (Server-Sent Events):**
```
data: {"content":"State"}
data: {"content":" management"}
data: {"content":" in"}
data: {"content":" React"}
...
data: [DONE]
```

### Delete Chat

**Endpoint:** `DELETE /api/v1/chat/delete/:id`

**Test Data:**
```bash
curl -X DELETE http://localhost:4000/api/v1/chat/delete/507f1f77bcf86cd799439020 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "id": "507f1f77bcf86cd799439020"
}
```

---

## Group Chat Endpoints

### Create Group Chat

**Endpoint:** `POST /api/v1/groupchat/create`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/groupchat/create \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "React Study Group",
    "description": "Study group for advanced React patterns",
    "creator": "507f1f77bcf86cd799439011",
    "members": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439013"],
    "course": "507f1f77bcf86cd799439012",
    "avatar": "https://example.com/group-avatar.png"
  }'
```

**Response:**
```json
{
  "message": "success",
  "groupChat": {
    "_id": "507f1f77bcf86cd799439030",
    "name": "React Study Group",
    "description": "Study group for advanced React patterns",
    "creator": "507f1f77bcf86cd799439011",
    "members": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439013"],
    "course": "507f1f77bcf86cd799439012",
    "isActive": true,
    "messages": [],
    "createdAt": "2024-01-15T11:00:00Z"
  }
}
```

**Note:** Max 5 members per group. Creator is automatically included.

### List Group Chats for Course

**Endpoint:** `GET /api/v1/groupchat/list/:courseID`

**Test Data:**
```bash
curl -X GET http://localhost:4000/api/v1/groupchat/list/507f1f77bcf86cd799439012 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "groupChats": [
    {
      "_id": "507f1f77bcf86cd799439030",
      "name": "React Study Group",
      "members": [
        {
          "_id": "507f1f77bcf86cd799439011",
          "username": "student1",
          "avatar": "http://localhost:4000/images/user_placeholder.png"
        }
      ],
      "creator": { "username": "student1" },
      "lastMessageAt": null
    }
  ]
}
```

### Get Group Chat Details

**Endpoint:** `GET /api/v1/groupchat/:id`

**Test Data:**
```bash
curl -X GET http://localhost:4000/api/v1/groupchat/507f1f77bcf86cd799439030 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "groupChat": {
    "_id": "507f1f77bcf86cd799439030",
    "name": "React Study Group",
    "description": "Study group for advanced React patterns",
    "members": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "username": "student1",
        "avatar": "http://localhost:4000/images/user_placeholder.png",
        "email": "student1@example.com"
      }
    ],
    "messages": []
  }
}
```

### Add Member to Group Chat

**Endpoint:** `POST /api/v1/groupchat/add-member`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/groupchat/add-member \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "groupChatId": "507f1f77bcf86cd799439030",
    "userId": "507f1f77bcf86cd799439014"
  }'
```

**Response:**
```json
{
  "message": "Member added successfully",
  "groupChat": {
    "_id": "507f1f77bcf86cd799439030",
    "members": [
      { "_id": "507f1f77bcf86cd799439011", "username": "student1" },
      { "_id": "507f1f77bcf86cd799439014", "username": "student2" }
    ]
  }
}
```

**Error (if exceeds 5 members):**
```json
{
  "status": 400,
  "error": "Group cannot have more than 5 members"
}
```

### Remove Member from Group Chat

**Endpoint:** `POST /api/v1/groupchat/remove-member`

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/groupchat/remove-member \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "groupChatId": "507f1f77bcf86cd799439030",
    "userId": "507f1f77bcf86cd799439014"
  }'
```

**Response:**
```json
{
  "message": "Member removed successfully",
  "groupChat": {
    "_id": "507f1f77bcf86cd799439030",
    "members": [
      { "_id": "507f1f77bcf86cd799439011", "username": "student1" }
    ]
  }
}
```

### Delete Group Chat

**Endpoint:** `DELETE /api/v1/groupchat/:id`

**Test Data:**
```bash
curl -X DELETE http://localhost:4000/api/v1/groupchat/507f1f77bcf86cd799439030 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "Group chat deleted successfully"
}
```

---

## Flashcard Endpoints

### 📌 Two Ways to Create Flashcards

There are **two different endpoints** with different request formats:

| **Method** | **Endpoint** | **Request Body** | **Use Case** |
|-----------|------------|-----------------|-----------|
| **Manual** | `POST /api/v1/flashcards/create` | Full card details (front, back, tags, etc.) | Student manually types flashcards |
| **AI** | `POST /api/v1/flashcards/:courseId/generate-from-pdf` | Optional topic only | "@studyGAI make flashcards on Chapter X" |

---

### Create Flashcards (Manual)

**Endpoint:** `POST /api/v1/flashcards/create`

**When to use:** Student or instructor manually creates flashcards with full details

**Request must include:**
- `creator` — your user ID
- `course` — course ID where cards go
- `cards[]` — array with front/back/tags/easeFactor/interval for EACH card

**Test Data:**
```bash
curl -X POST http://localhost:4000/api/v1/flashcards/create \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "React Hooks Batch 1",
    "creator": "507f1f77bcf86cd799439011",
    "course": "507f1f77bcf86cd799439012",
    "cards": [
      {
        "front": "What is useState used for?",
        "back": "useState allows you to add state to functional components. It returns an array with the current state value and a function to update it.",
        "tags": ["hooks", "state", "beginner"],
        "easeFactor": 2.5,
        "interval": 0
      },
      {
        "front": "Explain the useEffect dependency array",
        "back": "The dependency array tells useEffect when to run the effect. An empty array runs once on mount, omitting it runs after every render, and specific dependencies run when those values change.",
        "tags": ["hooks", "effects", "intermediate"],
        "easeFactor": 2.5,
        "interval": 0
      },
      {
        "front": "What is useContext?",
        "back": "useContext lets you consume context values in functional components without wrapping them in a Consumer component.",
        "tags": ["hooks", "context", "intermediate"],
        "easeFactor": 2.5,
        "interval": 0
      }
    ]
  }'
```

**Response:**
```json
{
  "message": "success",
  "flashcards": [
    {
      "front": "What is useState used for?",
      "back": "useState allows you to add state...",
      "tags": ["hooks", "state", "beginner"],
      "creator": "507f1f77bcf86cd799439011",
      "easeFactor": 2.5,
      "interval": 0,
      "dueDate": null,
      "reviewCount": 0,
      "stats": {}
    },
    { "...": "more cards..." }
  ]
}
```

---

### Generate Flashcards from PDF (AI-Powered)

**Endpoint:** `POST /api/v1/flashcards/:courseId/generate-from-pdf`

**When to use:** AI automatically creates flashcards from course PDF

**Request is simple:**
- `courseId` — in URL (required)
- `topic` — optional (e.g., "Chapter 3") to focus generation
- Body can be empty `{}` or include `{"topic": "..."}`

**Prerequisites:**
- Course must have a PDF uploaded and processed (`POST /api/v1/upload/doc`)
- User must be the course creator

**Test Data (generate from entire PDF):**
```bash
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/generate-from-pdf \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Test Data (generate for specific topic):**
```bash
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/generate-from-pdf \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Chapter 3: React Hooks"
  }'
```

**Response (AI creates the cards automatically):**
```json
{
  "message": "Flashcards generated and saved successfully",
  "count": 12,
  "courseId": "507f1f77bcf86cd799439012",
  "flashcards": [
    {
      "front": "What is useState used for?",
      "back": "useState is a Hook that allows you to add state variables to functional components. It returns an array with two elements: the current state value and a function to update it.",
      "tags": ["hooks", "state", "ai-generated"],
      "creator": "507f1f77bcf86cd799439011",
      "easeFactor": 2.5,
      "interval": 0,
      "dueDate": null,
      "reviewCount": 0,
      "stats": {}
    },
    {
      "front": "Explain the dependency array in useEffect",
      "back": "The dependency array controls when the effect runs. An empty array means it runs once after mount. Omitting it runs after every render. Specific values mean it runs when those values change.",
      "tags": ["hooks", "effects", "ai-generated"],
      "creator": "507f1f77bcf86cd799439011",
      "easeFactor": 2.5,
      "interval": 0,
      "dueDate": null,
      "reviewCount": 0,
      "stats": {}
    }
  ]
}
```

**Error Response (no PDF):**
```json
{
  "status": 400,
  "error": "No PDF content found. Please upload a PDF to the course first."
}
```

---

### List Flashcards for Course

**Endpoint:** `GET /api/v1/flashcards/list/:courseID`

**Test Data:**
```bash
curl -X GET http://localhost:4000/api/v1/flashcards/list/507f1f77bcf86cd799439012 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "courseId": "507f1f77bcf86cd799439012",
  "title": "Advanced React 2024",
  "flashcards": [
    {
      "front": "What is useState used for?",
      "back": "useState allows you to add state...",
      "tags": ["hooks", "state", "beginner"],
      "easeFactor": 2.5,
      "interval": 0,
      "reviewCount": 0,
      "stats": {
        "507f1f77bcf86cd799439011": {
          "reviewCount": 2,
          "lastReviewedAt": "2024-01-15T12:00:00Z",
          "interval": 1,
          "easeFactor": 2.65,
          "lastRating": "Good"
        }
      }
    }
  ]
}
```

### Review a Flashcard

**Endpoint:** `POST /api/v1/flashcards/:id/review`

**Test Data (Anki-style ratings):**
```bash
# Rating: "Again" (forgot, 1-day interval)
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/review \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardIndex": 0,
    "difficulty": "Again"
  }'

# Rating: "Hard" (struggled but got it)
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/review \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardIndex": 0,
    "difficulty": "Hard"
  }'

# Rating: "Good" (correct, increase interval)
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/review \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardIndex": 0,
    "difficulty": "Good"
  }'

# Rating: "Easy" (very easy, big interval increase)
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/review \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cardIndex": 0,
    "difficulty": "Easy"
  }'
```

**Response (After "Good" rating):**
```json
{
  "message": "Card reviewed",
  "cardIndex": 0,
  "card": {
    "front": "What is useState used for?",
    "back": "useState allows...",
    "easeFactor": 2.55,
    "interval": 3,
    "dueDate": "2024-01-18T10:35:00Z",
    "reviewCount": 1,
    "lastReviewedAt": "2024-01-15T10:35:00Z",
    "stats": {
      "507f1f77bcf86cd799439011": {
        "reviewCount": 1,
        "lastReviewedAt": "2024-01-15T10:35:00Z",
        "interval": 3,
        "easeFactor": 2.55,
        "lastRating": "Good"
      }
    }
  }
}
```

### Get Due Flashcards (Study Mode)

**Endpoint:** `GET /api/v1/flashcards/due/:courseId/:userId`

**Test Data:**
```bash
curl -X GET http://localhost:4000/api/v1/flashcards/due/507f1f77bcf86cd799439012/507f1f77bcf86cd799439011 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "success",
  "dueCount": 3,
  "due": [
    {
      "front": "What is useState used for?",
      "back": "useState allows...",
      "tags": ["hooks", "state"],
      "interval": 0,
      "dueDate": null
    },
    {
      "front": "Explain useEffect dependency array",
      "back": "The dependency array...",
      "tags": ["hooks", "effects"],
      "interval": 1,
      "dueDate": "2024-01-15T15:00:00Z"
    }
  ]
}
```

### Delete Flashcard

**Endpoint:** `DELETE /api/v1/flashcards/:id/:cardIndexOrId`

**Test Data:**
```bash
# Delete by index
curl -X DELETE http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/0 \
  -H "Authorization: $JWT_TOKEN"

# Delete by card ID (if _id present)
curl -X DELETE http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/507f1f77bcf86cd799439040 \
  -H "Authorization: $JWT_TOKEN"
```

**Response:**
```json
{
  "message": "Flashcard deleted",
  "flashcards": [
    { "front": "...", "back": "..." }
  ]
}
```

---

## AI-Powered Flashcard Generation

### Generate Flashcards from PDF

**Endpoint:** `POST /api/v1/flashcards/:courseId/generate-from-pdf`

**Prerequisites:**
- Course must have a PDF uploaded and processed
- User must be the course creator or a member

**Test Data (generate from entire PDF):**
```bash
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/generate-from-pdf \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Test Data (generate for specific topic):**
```bash
curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/generate-from-pdf \
  -H "Authorization: $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Chapter 3: React Hooks"
  }'
```

**Response:**
```json
{
  "message": "Flashcards generated and saved successfully",
  "count": 12,
  "courseId": "507f1f77bcf86cd799439012",
  "flashcards": [
    {
      "front": "What is useState used for?",
      "back": "useState is a Hook that allows you to add state variables to functional components. It returns an array with two elements: the current state value and a function to update it.",
      "tags": ["hooks", "state", "ai-generated"],
      "creator": "507f1f77bcf86cd799439011",
      "easeFactor": 2.5,
      "interval": 0,
      "dueDate": null,
      "reviewCount": 0,
      "stats": {}
    },
    {
      "front": "Explain the dependency array in useEffect",
      "back": "The dependency array controls when the effect runs. An empty array means it runs once after mount. Omitting it runs after every render. Specific values mean it runs when those values change.",
      "tags": ["hooks", "effects", "ai-generated"],
      "creator": "507f1f77bcf86cd799439011",
      "easeFactor": 2.5,
      "interval": 0,
      "dueDate": null,
      "reviewCount": 0,
      "stats": {}
    },
    {
      "front": "What is useContext?",
      "back": "useContext is a Hook that lets you read and subscribe to context from your component. It accepts a context object (created with React.createContext) and returns the current context value.",
      "tags": ["hooks", "context", "ai-generated"],
      "creator": "507f1f77bcf86cd799439011",
      "easeFactor": 2.5,
      "interval": 0,
      "dueDate": null,
      "reviewCount": 0,
      "stats": {}
    }
  ]
}
```

**Error Response (no PDF):**
```json
{
  "status": 400,
  "error": "No PDF content found. Please upload a PDF to the course first."
}
```

---

## Workflow: Upload File (Any Format) → Generate Flashcards → Study

### Complete Flow Example

1. **Create course**
   ```bash
   curl -X POST http://localhost:4000/api/v1/course/new \
     -H "Authorization: $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "title": "React Advanced",
       "description": "Advanced React patterns"
     }'
   # Returns: courseId = "507f1f77bcf86cd799439012"
   ```

2. **Upload document (PDF, DOCX, TXT, XLSX, etc. - auto-extracts text via llama-parse)**
   ```bash
   # Upload PDF
   curl -X POST http://localhost:4000/api/v1/upload/doc \
     -H "Authorization: $JWT_TOKEN" \
     -F "files=@./react-course.pdf" \
     -F "courseId=507f1f77bcf86cd799439012"

   # Or upload DOCX
   curl -X POST http://localhost:4000/api/v1/upload/doc \
     -H "Authorization: $JWT_TOKEN" \
     -F "files=@./react-course.docx" \
     -F "courseId=507f1f77bcf86cd799439012"

   # Response includes processing status
   ```

3. **Generate flashcards using AI**
   ```bash
   curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/generate-from-pdf \
     -H "Authorization: $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{}'
   # Returns 12+ auto-generated flashcards
   ```

4. **List generated flashcards**
   ```bash
   curl -X GET http://localhost:4000/api/v1/flashcards/list/507f1f77bcf86cd799439012 \
     -H "Authorization: $JWT_TOKEN"
   # Shows all flashcards (manual + AI-generated)
   ```

5. **Get due cards for study**
   ```bash
   curl -X GET http://localhost:4000/api/v1/flashcards/due/507f1f77bcf86cd799439012/507f1f77bcf86cd799439011 \
     -H "Authorization: $JWT_TOKEN"
   # All newly generated cards are due (interval=0)
   ```

6. **Start reviewing (spaced repetition)**
   ```bash
   curl -X POST http://localhost:4000/api/v1/flashcards/507f1f77bcf86cd799439012/review \
     -H "Authorization: $JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "cardIndex": 0,
       "difficulty": "Good"
     }'
   # Card scheduled for next review based on Anki algorithm
   ```

---

## AI Flashcard Generation Features

### What the AI Does
- Analyzes PDF content and extracts key concepts
- Generates 10-15 flashcards per request
- Creates clear questions (front) and concise answers (back)
- Assigns relevant tags based on topics
- Balances basic and advanced questions

### Supported Topics
- Any PDF-based course material
- Technical documentation
- Academic textbooks
- Study guides
- Research papers (if text-extractable)

### Tips for Better Flashcards
1. **Upload complete documents** — larger files = more context = better cards (supports PDF, DOCX, TXT, XLSX, PPTX, and more via llama-parse)
2. **Use structured files** — clearly formatted chapters/sections help
3. **Request multiple times** — each request may generate different cards
4. **Review and edit** — modify auto-generated cards for accuracy
5. **Add manual cards** — combine AI-generated with human-created cards
6. **Note:** llama-parse processes files much faster and supports more formats than pdf-parse fallback

---

## Test Scenarios

### Scenario 1: Create Course & Add Flashcards

1. Register user (get JWT token)
2. Create course with `POST /api/v1/course/new`
3. Create flashcards with `POST /api/v1/flashcards/create`
4. List flashcards with `GET /api/v1/flashcards/list/:courseID`
5. Review a card with `POST /api/v1/flashcards/:courseId/review`

### Scenario 2: Study Session with Spaced Repetition

1. Get due cards with `GET /api/v1/flashcards/due/:courseId/:userId`
2. For each card, emit reviews via WebSocket or REST
3. System calculates new interval & easeFactor based on rating
4. Cards scheduled for future review

### Scenario 3: Group Study Session

1. Create group chat with `POST /api/v1/groupchat/create` (max 5 members)
2. Join via WebSocket with `join-room` event
3. Members send messages and AI requests in real-time
4. All members see responses and can track progress
5. Leave with `leave-room` event

### Scenario 4: PDF Upload & AI Chat with Context

1. Upload PDF with `POST /api/v1/upload/doc` and include courseId
2. Server extracts PDF text automatically
3. Send chat message with courseId to `POST /api/v1/chat/send`
4. Groq AI uses PDF content as system context in response

---

## Error Handling

### Common Error Codes

**400 Bad Request** — Invalid input or validation failed
```json
{
  "status": 400,
  "error": "Group cannot have more than 5 members"
}
```

**401 Unauthorized** — JWT token missing or invalid
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

**403 Forbidden** — User lacks permission
```json
{
  "status": 403,
  "error": "Only creator can update flashcards"
}
```

**404 Not Found** — Resource not found
```json
{
  "status": 404,
  "error": "Course not found"
}
```

**500 Internal Server Error** — Server error
```json
{
  "status": 500,
  "error": "Database connection failed"
}
```

---

## Tips for Testing

1. **Use Postman or Insomnia** for REST endpoints — import this file as test data
2. **Export JWT tokens** to environment variables for easier reuse
3. **Test WebSocket** with browser console or specialized tools (Socket.IO tester)
4. **Check Swagger UI** at `/docs` for interactive testing and request/response examples
5. **Monitor logs** in terminal while testing to debug any issues
6. **Test group limits** by trying to add more than 5 members
7. **Test spaced repetition** by rating same card multiple times with different ratings

---

End of test data documentation.

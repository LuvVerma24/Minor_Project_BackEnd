# College Faculty-Student Portal — Backend API

A production-grade REST API backend for a college faculty-student portal built with **Node.js**, **Express**, and **MongoDB (Mongoose)**, architected specifically to run smoothly on **Render's free tier** with a **MongoDB Atlas M0 (Free Tier)** cluster.

---

## Key Free-Tier Architectural Design

| Constraint / Feature | Implementation Strategy |
| :--- | :--- |
| **Atlas M0 Connection Limits** | Mongoose connection capped with `maxPoolSize: 10` to avoid connection exhaustion. |
| **Startup Resilience** | Exponential backoff connection retry loop on startup failure (prevents Render container crash if Atlas is slow to wake up). |
| **Render Cold-Start Sleep** | Instant `GET /health` endpoint that responds with `{ status: "healthy", uptime }` with **zero DB calls**, specifically designed for free external uptime ping monitors (e.g. UptimeRobot, BetterStack) to ping every 5–10 minutes. |
| **Abuse & Email Cost Protection** | `express-rate-limit` configured with a strict limiter (**5 requests per 15 min per email**) on OTP-sending endpoints, and a general limiter (**100 requests per 15 min per IP**) on all other routes. |
| **Security & Headers** | `helmet` for HTTP security headers, `compression` for gzip payload optimization, and strict `cors` restricted to `ALLOWED_ORIGIN` (never `*`). |
| **Error Handling** | Centralized error-handling middleware that returns standardized `{ success: false, message }` JSON responses and **never leaks stack traces in production**. |
| **Database Indexing** | Indexed lookups: `ClassRoom.joinCode` (unique), `Attendance` compound on `(classId, rollNo, date)` (unique), `Mark` compound on `(classId, examId, rollNo)` (unique), `JoinRequest` compound on `(classId, status)`, and `OtpToken` TTL index on `expiresAt`. |
| **AI Planner (Groq API)** | Calls Groq API wrapped with **3x exponential backoff retry** for rate limits (`HTTP 429`) and network errors. Generates and **caches plan in MongoDB immediately** so network flakes never lose work. Only regenerates if the teacher passes `regenerate: true`. |
| **OTP Emails** | Transactional email integration via **Resend** or **Brevo** free tier (configurable via `EMAIL_PROVIDER`), with OTPs hashed using `bcrypt` and expiring in 10 minutes (never stored in plaintext). In development/test mode without an API key, OTPs are formatted and printed directly to the terminal for friction-free local testing. |

---

## ⭐️ Critical Architectural Rule: Decoupled Attendance & Marks

> **Attendance and Marks NEVER depend on a student account existing.**

1. A teacher creates a classroom and can immediately submit attendance and exam marks using **roll numbers only** (e.g. `CS-01`, `CS-02`, `CS-03`).
2. These records are stored keyed strictly by `(classId, rollNo)` in `Attendance` and `(classId, examId, rollNo)` in `Mark`, completely independent of any `User` or `Enrollment` document.
3. When a student eventually creates an account and requests to join the class with their roll number, the teacher approves the request, creating an `Enrollment` record.
4. Once enrolled, the student receives **read-only** access to **all past and future attendance and marks** tied to that roll number in that class.

---

## Project Structure

```
MINOR_PROJECT/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── postman_collection.json          # Ready-to-import Postman Collection
├── src/
│   ├── app.js                       # Express app configuration & middlewares
│   ├── server.js                    # Server startup with retry & graceful shutdown
│   ├── config/
│   │   ├── db.js                    # MongoDB connection (maxPoolSize: 10 + retry)
│   │   └── env.js                   # Environment variables loader & validator
│   ├── models/
│   │   ├── User.js                  # Teachers and Students
│   │   ├── ClassRoom.js             # Subject, faculty, joinCode (unique)
│   │   ├── JoinRequest.js           # Student class join requests
│   │   ├── Enrollment.js            # Approved roll number to student mappings
│   │   ├── Attendance.js            # (classId, rollNo, date) compound unique
│   │   ├── Exam.js                  # Exam columns with maxMarks
│   │   ├── Mark.js                  # (classId, examId, rollNo) compound unique
│   │   ├── PlannerDay.js            # Day-by-day syllabus plan
│   │   ├── Notice.js                # Class announcements with read tracking
│   │   └── OtpToken.js              # Hashed OTPs with TTL auto-expiry index
│   ├── middleware/
│   │   ├── auth.js                  # JWT authentication & role authorization
│   │   ├── rateLimiter.js           # Strict OTP limiter & general limiter
│   │   └── errorHandler.js          # Centralized error handler
│   ├── services/
│   │   ├── emailService.js          # Resend / Brevo transactional emails
│   │   ├── groqService.js           # Groq LLM API with exponential retry
│   │   └── otpService.js            # Secure OTP generation & bcrypt hashing
│   ├── controllers/
│   │   ├── authController.js        # Signup (2-step), login, forgot-pw (3-step)
│   │   ├── classController.js       # Classes, join requests, enrollments
│   │   ├── attendanceController.js  # Roll number attendance & stats
│   │   ├── examController.js        # Exam columns & roll number marks
│   │   ├── noticeController.js      # Class notices & student read receipts
│   │   └── plannerController.js     # AI curriculum planner with DB caching
│   ├── routes/
│   │   ├── index.js                 # Central router & /health
│   │   ├── authRoutes.js
│   │   ├── classRoutes.js
│   │   ├── attendanceRoutes.js
│   │   ├── examRoutes.js
│   │   ├── markRoutes.js
│   │   ├── noticeRoutes.js
│   │   └── plannerRoutes.js
│   └── utils/
│       ├── helpers.js               # Join code generator & date normalizer
│       └── pagination.js            # Standard pagination helper (?page=&limit=)
└── tests/
    └── test_verification.js         # Automated end-to-end test suite
```

---

## Quick Setup Instructions

### 1. Prerequisites
- **Node.js** v18+ (tested on Node.js v24)
- **MongoDB** (Local instance or MongoDB Atlas M0 URI)

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure the following variables in `.env`:
```ini
# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB Atlas Connection (maxPoolSize=10 is enforced in code)
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.mongodb.net/faculty_portal?retryWrites=true&w=majority

# JWT Authentication
JWT_SECRET=your_super_secret_jwt_key_here_change_in_production
JWT_EXPIRES_IN=7d

# Frontend CORS Origin (Strict security: cannot be "*")
ALLOWED_ORIGIN=http://localhost:3000

# Email Domain Restriction (Optional: e.g. college.edu, or leave blank to allow any)
ALLOWED_EMAIL_DOMAIN=

# Transactional Email Service (Resend or Brevo Free Tier)
# If left as placeholder or blank in development, OTPs are printed to terminal console
EMAIL_PROVIDER=resend
EMAIL_API_KEY=re_your_api_key_here
EMAIL_FROM=Faculty Portal <onboarding@resend.dev>

# Groq API for AI Syllabus Planner (Free tier at console.groq.com)
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

### 4. Run Server Locally
- **Development mode (with auto-watch)**:
  ```bash
  npm run dev
  ```
- **Production mode**:
  ```bash
  npm start
  ```

---

## Automated Verification Suite

Run the comprehensive automated test suite:
```bash
npm test
```

This automated suite runs against a local or test MongoDB database and verifies:
1. **Health Check (`GET /health`)**: Confirms instant response with 0 database queries.
2. **Strict Rate Limiter**: Sends 5 requests to `/api/auth/signup/initiate` (all pass 200), and confirms the **6th request within 15 minutes is blocked with HTTP 429 Too Many Requests**.
3. **Decoupled Attendance & Marks**: Creates attendance and marks for roll numbers (`CS-101`, `CS-102`, `CS-103`) when **zero student User and zero Enrollment documents exist**.
4. **Late Student Linking**: Student creates an account later, requests to join with `rollNo: "CS-101"`, teacher approves, and student successfully reads their past attendance history and marks.
5. **Pagination**: Verifies `?page=&limit=` on list endpoints with `totalPages`, `hasNextPage`, and `hasPrevPage`.
6. **AI Planner Caching**: Confirms 2nd generation call immediately returns the cached plan from MongoDB with `cached: true` without invoking Groq API.
7. **Notices & Read Receipts**: Confirms student can mark notices as read.

---

## Postman Testing Instructions

A complete, pre-configured collection is provided in [postman_collection.json](postman_collection.json).

### 1. Import Collection
1. Open **Postman**.
2. Click **Import** (top left).
3. Select `postman_collection.json` from this project folder.

### 2. Automated Token & Variable Extraction
The collection has built-in test scripts that automatically capture and persist collection variables:
- `teacherToken` — Automatically saved when Teacher verifies signup or logs in.
- `studentToken` — Automatically saved when Student verifies signup or logs in.
- `classId` & `joinCode` — Automatically saved when Teacher creates a class.
- `joinRequestId` — Automatically saved when Student requests to join.
- `examId` — Automatically saved when Teacher creates an exam column.
- `noticeId` — Automatically saved when Teacher creates a notice.
- `dayId` — Automatically saved when AI Planner is generated.

### 3. Step-by-Step Testing Sequence

#### Phase 1: Authentication & Health Check
1. **Health Check**: Run `01. Health Check > Health Check (No DB Call)` -> Returns `200 OK` instantly with `{ status: "healthy" }`.
2. **Teacher Signup Step 1**: Run `02. Authentication > 1. Signup Initiate (Teacher)`. Check your terminal for the generated 6-digit OTP code (in dev mode, printed inside a box).
3. **Teacher Signup Step 2**: Put the 6-digit OTP into `02. Authentication > 2. Signup Verify (Teacher)` and send -> Returns `201 Created` with JWT `token`. The variable `teacherToken` is automatically set!
4. **Student Signup Step 1 & 2**: Run `4. Signup Initiate (Student)` and `5. Signup Verify (Student)` using the OTP printed to the console -> Sets `studentToken`.

#### Phase 2: Classroom & Decoupled Attendance / Marks
5. **Teacher Creates Class**: Run `03. Classrooms > 1. Create Class (Teacher)`.
   - The server automatically generates a unique 6-character alphanumeric `joinCode`.
   - `classId` and `joinCode` variables are automatically saved.
6. **Teacher Submits Today's Attendance**:
   - Run `04. Attendance > 1. Submit Today's Attendance (Teacher)` with roll numbers:
     ```json
     {
       "classId": "{{classId}}",
       "date": "2026-10-06",
       "records": [
         { "rollNo": "CS-01", "status": "present" },
         { "rollNo": "CS-02", "status": "absent" },
         { "rollNo": "CS-03", "status": "present" }
       ]
     }
     ```
   - Notice that `CS-01`, `CS-02`, and `CS-03` do **NOT** have to be registered students! The attendance is stored immediately.
7. **Teacher Creates Exam Column**:
   - Run `05. Exams & Marks > 1. Create Exam Column (Teacher)` (`examName: "Midterm Exam 1", maxMarks: 50`).
   - Automatically sets `examId`.
8. **Teacher Submits Marks**:
   - Run `05. Exams & Marks > 3. Submit Marks (Teacher)` with marks for roll numbers `CS-01`, `CS-02`, `CS-03`.
   - Validates `0 <= marksObtained <= maxMarks`.
9. **Teacher Edits Marks**:
   - Run `05. Exams & Marks > 4. Edit Marks Record (Teacher)` with `PUT /api/marks` (`rollNo: "CS-02", marksObtained: 45`).
   - Validates teacher classroom ownership and `0 <= marksObtained <= maxMarks`.

#### Phase 3: Student Linking & Read-Only Access
10. **Student Submits Join Request**:
    - Run `03. Classrooms > 4. Student Join Request` with `joinCode: "{{joinCode}}"` and `rollNo: "CS-01"`.
    - Automatically sets `joinRequestId`.
11. **Teacher Approves Request**:
    - Run `03. Classrooms > 6. Teacher Approve/Reject Join Request` (`action: "approve"`).
    - Creates `Enrollment` linking Student to roll number `CS-01`.
12. **Student Views Past Attendance**:
    - Run `04. Attendance > 4. Student View Attendance`.
    - Student Alice (roll `CS-01`) immediately sees the attendance marked in Step 6, plus their attendance summary statistics!
13. **Student Views Past Marks**:
    - Run `05. Exams & Marks > 6. Student View Marks`.
    - Student Alice immediately sees her marks (`47/50`) marked in Step 8!

#### Phase 4: Pagination Testing
13. **Paginated Attendance**:
    - Run `04. Attendance > 3. Teacher List Attendance (Paginated)` with query params `?page=1&limit=2`.
    - Inspect the response JSON:
      ```json
      {
        "success": true,
        "items": [...],
        "pagination": {
          "total": 3,
          "page": 1,
          "limit": 2,
          "totalPages": 2,
          "hasNextPage": true,
          "hasPrevPage": false
        }
      }
      ```

#### Phase 5: AI Syllabus Planner
14. **Generate Planner**:
    - Run `07. AI Syllabus Planner > 1. Generate AI Planner (Teacher)`.
    - Generates 15 lecture days using Groq API (or intelligent fallback in offline mode) and saves them into MongoDB.
15. **Verify Caching**:
    - Send the exact same request again -> Returns `cached: true` immediately without calling Groq API.
16. **Update Day Status**:
    - Run `07. AI Syllabus Planner > 3. Mark Planner Day Status (Teacher)` with `status: "done"`.
17. **Student/Teacher Views Planner**:
    - Run `07. AI Syllabus Planner > 2. Get Full Planner` -> Returns updated completion percentage (e.g., `6.7%` completion).

#### Phase 6: Notices & Read Receipts
18. **Teacher Creates Notice**: Run `06. Notices > 1. Create Notice (Teacher)`.
19. **Student Marks Notice Read**: Run `06. Notices > 3. Mark Notice Read (Student)`.
20. **Student Lists Notices**: Run `06. Notices > 2. List Notices` -> Notice returns `isRead: true`.

---

## Deployment to Render Free Tier

1. Push this repository to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com), click **New + > Web Service**.
3. Select your repository.
4. Set the following build configuration:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Under **Environment Variables**, add:
   - `NODE_ENV`: `production`
   - `MONGODB_URI`: `<Your MongoDB Atlas M0 Connection String>`
   - `JWT_SECRET`: `<A strong random 64-character secret>`
   - `ALLOWED_ORIGIN`: `https://your-deployed-frontend.vercel.app` (do not use `*`)
   - `EMAIL_PROVIDER`: `resend` (or `brevo`)
   - `EMAIL_API_KEY`: `<Your Resend or Brevo API Key>`
   - `EMAIL_FROM`: `College Portal <onboarding@resend.dev>`
   - `GROQ_API_KEY`: `<Your Groq API Key>`
6. Set up a free uptime monitor (e.g., [UptimeRobot](https://uptimerobot.com) or [BetterStack](https://betterstack.com)) to ping `https://your-app.onrender.com/health` every 10 minutes to prevent Render's free tier instance from sleeping during testing hours!

/**
 * Comprehensive Automated Verification Test Suite
 * Tests:
 * 1. Health endpoint (instant response, no DB call)
 * 2. Strict Rate Limiter: Blocks the 6th OTP request within 15 minutes for the same email
 * 3. CRITICAL DESIGN RULE: Attendance and Marks created for roll numbers with ZERO User or Enrollment documents existing
 * 4. Linking: Student account signs up later, gets approved, and can read all past attendance/marks for their roll number
 * 5. Pagination: Tests ?page=&limit= with boundary pages, hasNextPage, hasPrevPage, totalPages
 * 6. AI Planner: Generation, caching in DB, day status updates
 * 7. Notices & Student Read status
 */

const http = require('http');
const mongoose = require('mongoose');
const app = require('../src/app');
const User = require('../src/models/User');
const ClassRoom = require('../src/models/ClassRoom');
const Enrollment = require('../src/models/Enrollment');
const Attendance = require('../src/models/Attendance');
const Exam = require('../src/models/Exam');
const Mark = require('../src/models/Mark');
const OtpToken = require('../src/models/OtpToken');
const PlannerDay = require('../src/models/PlannerDay');
const Notice = require('../src/models/Notice');
const JoinRequest = require('../src/models/JoinRequest');

const TEST_DB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/faculty_portal_test';

let server;
let serverPort;

// Helper to make HTTP requests
const request = ({ method, path, headers = {}, body = null }) => {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };

    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (e) {
            parsed = raw;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
};

const runTests = async () => {
  console.log('================================================================');
  console.log('STARTING BACKEND VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  try {
    // Connect to test database
    await mongoose.connect(TEST_DB_URI, { maxPoolSize: 10 });
    console.log(`[Test Setup] Connected to MongoDB at ${TEST_DB_URI}`);

    // Clean test database collections
    await Promise.all([
      User.deleteMany({}),
      ClassRoom.deleteMany({}),
      Enrollment.deleteMany({}),
      Attendance.deleteMany({}),
      Exam.deleteMany({}),
      Mark.deleteMany({}),
      OtpToken.deleteMany({}),
      PlannerDay.deleteMany({}),
      Notice.deleteMany({}),
      JoinRequest.deleteMany({}),
    ]);
    console.log('[Test Setup] Cleaned all collections in test database.\n');

    // Start HTTP server on dynamic port
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        console.log(`[Test Setup] Test server listening on http://127.0.0.1:${serverPort}\n`);
        resolve();
      });
    });

    // -------------------------------------------------------------
    // TEST 1: Health Check Endpoint (No DB call, instant response)
    // -------------------------------------------------------------
    console.log('-------------------------------------------------------------');
    console.log('TEST 1: Health Check Endpoint (GET /health)');
    console.log('-------------------------------------------------------------');
    const healthRes = await request({ method: 'GET', path: '/health' });
    if (healthRes.status === 200 && healthRes.body.status === 'healthy') {
      console.log('✔ PASS: GET /health returned 200 with { status: "healthy" }');
    } else {
      throw new Error(`Health check failed: ${JSON.stringify(healthRes.body)}`);
    }

    // -------------------------------------------------------------
    // TEST 2: Strict Rate Limiter (Blocks 6th OTP request in 15m)
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 2: Strict Rate Limiter on OTP-Sending Endpoint');
    console.log('-------------------------------------------------------------');
    const testEmail = 'prof.sharma@college.edu';
    const signupData = {
      role: 'teacher',
      fullName: 'Prof. Sharma',
      email: testEmail,
      password: 'StrongPassword123',
      confirmPassword: 'StrongPassword123',
      post: 'Assistant Professor',
      department: 'Computer Science',
      phone: '9876543210',
    };

    console.log(`Sending 5 requests to /api/auth/signup/initiate for ${testEmail}...`);
    for (let i = 1; i <= 5; i++) {
      const res = await request({
        method: 'POST',
        path: '/api/auth/signup/initiate',
        body: signupData,
      });
      if (res.status !== 200) {
        throw new Error(`Expected attempt ${i} to succeed with 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      }
      console.log(`  Attempt ${i}: Allowed (Status 200)`);
    }

    console.log('Sending 6th request (should be BLOCKED by rate limiter)...');
    const sixthRes = await request({
      method: 'POST',
      path: '/api/auth/signup/initiate',
      body: signupData,
    });

    if (sixthRes.status === 429 && sixthRes.body.success === false) {
      console.log('✔ PASS: 6th OTP request was successfully BLOCKED with HTTP 429 Too Many Requests!');
      console.log(`  Message returned: "${sixthRes.body.message}"`);
    } else {
      throw new Error(`Expected HTTP 429 on 6th request, got ${sixthRes.status}: ${JSON.stringify(sixthRes.body)}`);
    }

    // -------------------------------------------------------------
    // TEST 3: Auth Flow - Signup & Login
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 3: Auth Flow - Signup OTP Verification & Login');
    console.log('-------------------------------------------------------------');
    // Read the OTP stored for prof.sharma
    const latestOtp = await OtpToken.findOne({ email: testEmail, purpose: 'signup' }).sort({ createdAt: -1 });
    if (!latestOtp) {
      throw new Error('No OtpToken found in DB for teacher');
    }

    // Since in emailService fallback dev mode we know the OTP is in console or we can verify with a fresh teacher:
    // Let's create a fresh teacher with known credentials for testing
    const teacherEmail = 'teacher.test@college.edu';
    await request({
      method: 'POST',
      path: '/api/auth/signup/initiate',
      body: {
        ...signupData,
        email: teacherEmail,
        fullName: 'Prof. Test Teacher',
      },
    });

    // In tests we can either mock verify or find the token in DB:
    // Since OtpToken stores bcrypt hash, let's test OTP verification with a mocked known OTP
    const teacherOtpRecord = await OtpToken.findOne({ email: teacherEmail, purpose: 'signup' });
    const bcrypt = require('bcryptjs');
    const knownOtp = '654321';
    teacherOtpRecord.otpHash = await bcrypt.hash(knownOtp, 10);
    await teacherOtpRecord.save();

    const verifyRes = await request({
      method: 'POST',
      path: '/api/auth/signup/verify',
      body: {
        email: teacherEmail,
        otp: knownOtp,
      },
    });

    if (verifyRes.status !== 201 || !verifyRes.body.token) {
      throw new Error(`Signup verify failed: ${JSON.stringify(verifyRes.body)}`);
    }
    const teacherToken = verifyRes.body.token;
    const teacherId = verifyRes.body.user._id;
    console.log(`✔ PASS: Teacher registered & verified. Token acquired. Teacher ID: ${teacherId}`);

    // Verify Login
    const loginRes = await request({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: teacherEmail, password: 'StrongPassword123' },
    });
    if (loginRes.status !== 200 || !loginRes.body.token) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
    }
    console.log('✔ PASS: Teacher login successful with email and password.');

    // -------------------------------------------------------------
    // TEST 4: Teacher Creates Class & Regenerates Join Code
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 4: Classroom Creation & Join Code Generation');
    console.log('-------------------------------------------------------------');
    const createClassRes = await request({
      method: 'POST',
      path: '/api/classes',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        subjectName: 'Distributed Systems',
        numberOfStudents: 60,
        department: 'Computer Science',
        year: 'Final Year',
        section: 'A',
      },
    });

    if (createClassRes.status !== 201 || !createClassRes.body.classroom.joinCode) {
      throw new Error(`Create class failed: ${JSON.stringify(createClassRes.body)}`);
    }
    const classroom = createClassRes.body.classroom;
    const classId = classroom._id;
    const initialJoinCode = classroom.joinCode;
    console.log(`✔ PASS: Classroom created. ID: ${classId}, Server Generated Join Code: ${initialJoinCode}`);

    // Test regenerate join code
    const regenRes = await request({
      method: 'POST',
      path: `/api/classes/${classId}/regenerate-code`,
      headers: { Authorization: `Bearer ${teacherToken}` },
    });
    if (regenRes.status !== 200 || regenRes.body.joinCode === initialJoinCode) {
      throw new Error(`Regenerate join code failed: ${JSON.stringify(regenRes.body)}`);
    }
    const activeJoinCode = regenRes.body.joinCode;
    console.log(`✔ PASS: Join code regenerated to new unique code: ${activeJoinCode}`);

    // -------------------------------------------------------------
    // TEST 5: CRITICAL DESIGN RULE VERIFICATION
    // Attendance and Marks created for roll numbers with ZERO User or Enrollment documents
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 5: CRITICAL RULE - Attendance & Marks with ZERO User/Enrollment docs');
    console.log('-------------------------------------------------------------');

    // Confirm that 0 student User documents exist
    const studentUserCount = await User.countDocuments({ role: 'student' });
    const enrollmentCount = await Enrollment.countDocuments({ classId });
    console.log(`Current student User docs in DB: ${studentUserCount}`);
    console.log(`Current Enrollment docs in DB for this class: ${enrollmentCount}`);
    if (studentUserCount !== 0 || enrollmentCount !== 0) {
      throw new Error('Precondition failed: Student users or enrollments already exist!');
    }

    // Submit attendance for 3 unlinked roll numbers: "CS-101", "CS-102", "CS-103"
    const attendanceRes = await request({
      method: 'POST',
      path: '/api/attendance',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        date: '2026-10-01',
        records: [
          { rollNo: 'CS-101', status: 'present' },
          { rollNo: 'CS-102', status: 'absent' },
          { rollNo: 'CS-103', status: 'present' },
        ],
      },
    });

    if (attendanceRes.status !== 200 || attendanceRes.body.processedCount !== 3) {
      throw new Error(`Submit attendance failed: ${JSON.stringify(attendanceRes.body)}`);
    }
    console.log('✔ PASS: Attendance submitted for 3 roll numbers (CS-101, CS-102, CS-103) with ZERO student users in DB!');

    // Submit day 2 attendance as well (for pagination testing later)
    await request({
      method: 'POST',
      path: '/api/attendance',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        date: '2026-10-02',
        records: [
          { rollNo: 'CS-101', status: 'present' },
          { rollNo: 'CS-102', status: 'present' },
          { rollNo: 'CS-103', status: 'absent' },
        ],
      },
    });

    // Create an Exam Column
    const examRes = await request({
      method: 'POST',
      path: '/api/exams',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        examName: 'Midterm Exam 1',
        maxMarks: 50,
      },
    });

    if (examRes.status !== 201 || !examRes.body.exam._id) {
      throw new Error(`Create exam failed: ${JSON.stringify(examRes.body)}`);
    }
    const examId = examRes.body.exam._id;
    console.log(`✔ PASS: Exam column created: "Midterm Exam 1" (maxMarks: 50)`);

    // Submit Marks for unlinked roll numbers
    const marksRes = await request({
      method: 'POST',
      path: '/api/marks',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        examId,
        records: [
          { rollNo: 'CS-101', marksObtained: 45 },
          { rollNo: 'CS-102', marksObtained: 38 },
          { rollNo: 'CS-103', marksObtained: 48 },
        ],
      },
    });

    if (marksRes.status !== 200 || marksRes.body.processedCount !== 3) {
      throw new Error(`Submit marks failed: ${JSON.stringify(marksRes.body)}`);
    }
    console.log('✔ PASS: Marks entered for 3 roll numbers with ZERO student users or enrollments existing in MongoDB!');

    // Test Edit Marks (PUT /api/marks)
    const editMarksRes = await request({
      method: 'PUT',
      path: '/api/marks',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        examId,
        rollNo: 'CS-102',
        marksObtained: 44,
      },
    });

    if (editMarksRes.status !== 200 || editMarksRes.body.record?.marksObtained !== 44) {
      throw new Error(`Edit marks failed: ${JSON.stringify(editMarksRes.body)}`);
    }
    console.log('✔ PASS: Edit marks (PUT /api/marks) successfully updated CS-102 marks to 44/50!');

    // Test Edit Marks validation: cannot exceed maxMarks (50)
    const invalidEditRes = await request({
      method: 'PUT',
      path: '/api/marks',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        examId,
        rollNo: 'CS-102',
        marksObtained: 99,
      },
    });

    if (invalidEditRes.status !== 400) {
      throw new Error(`Expected HTTP 400 when marks exceed maxMarks, but got: ${invalidEditRes.status}`);
    }
    console.log('✔ PASS: Edit marks validation blocked score exceeding maxMarks (400 Bad Request)!');

    // -------------------------------------------------------------
    // TEST 6: Student Signs Up Later & Links to Roll Number
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 6: Student Signs Up Later, Gets Approved, and Reads Past Records');
    console.log('-------------------------------------------------------------');
    const studentEmail = 'student.alice@college.edu';
    await request({
      method: 'POST',
      path: '/api/auth/signup/initiate',
      body: {
        role: 'student',
        fullName: 'Alice Johnson',
        email: studentEmail,
        password: 'PasswordAlice123',
        confirmPassword: 'PasswordAlice123',
        department: 'Computer Science',
        year: 'Final Year',
        section: 'A',
        phone: '9123456780',
      },
    });

    const studentOtpDoc = await OtpToken.findOne({ email: studentEmail, purpose: 'signup' });
    studentOtpDoc.otpHash = await bcrypt.hash('112233', 10);
    await studentOtpDoc.save();

    const studentVerify = await request({
      method: 'POST',
      path: '/api/auth/signup/verify',
      body: { email: studentEmail, otp: '112233' },
    });
    const studentToken = studentVerify.body.token;
    console.log('✔ PASS: Student Alice Johnson registered successfully.');

    // Student requests to join class using activeJoinCode and rollNo "CS-101"
    const joinReqRes = await request({
      method: 'POST',
      path: '/api/classes/join-request',
      headers: { Authorization: `Bearer ${studentToken}` },
      body: {
        joinCode: activeJoinCode,
        year: 'Final Year',
        department: 'Computer Science',
        scholarNo: 'SCH-9988',
        rollNo: 'CS-101',
      },
    });

    if (joinReqRes.status !== 201 || !joinReqRes.body.joinRequest._id) {
      throw new Error(`Join request failed: ${JSON.stringify(joinReqRes.body)}`);
    }
    const joinRequestId = joinReqRes.body.joinRequest._id;
    console.log(`✔ PASS: Student submitted join request with rollNo: "CS-101". Request ID: ${joinRequestId}`);

    // Teacher approves join request
    const approveRes = await request({
      method: 'POST',
      path: '/api/classes/join-requests/respond',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        joinRequestId,
        action: 'approve',
      },
    });

    if (approveRes.status !== 200 || !approveRes.body.enrollment) {
      throw new Error(`Approval failed: ${JSON.stringify(approveRes.body)}`);
    }
    console.log('✔ PASS: Teacher approved request. Enrollment created linking student account to rollNo "CS-101"!');

    // NOW TEST READ-ONLY PAST RECORDS:
    // Alice (CS-101) queries attendance for this class
    const studentAttRes = await request({
      method: 'GET',
      path: `/api/attendance/${classId}`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });

    if (studentAttRes.status !== 200 || studentAttRes.body.items.length !== 2) {
      throw new Error(`Student attendance fetch failed: ${JSON.stringify(studentAttRes.body)}`);
    }
    console.log(`✔ PASS: Alice retrieved ${studentAttRes.body.items.length} attendance records that were marked BEFORE her account existed!`);
    console.log(`  Student Summary Stats: ${studentAttRes.body.studentSummary.presentClasses} present out of ${studentAttRes.body.studentSummary.totalClasses} (${studentAttRes.body.studentSummary.percentage}%)`);

    // Alice queries marks for this class
    const studentMarksRes = await request({
      method: 'GET',
      path: `/api/marks/${classId}`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });

    if (studentMarksRes.status !== 200 || studentMarksRes.body.items.length !== 1) {
      throw new Error(`Student marks fetch failed: ${JSON.stringify(studentMarksRes.body)}`);
    }
    console.log(`✔ PASS: Alice retrieved her marks: ${studentMarksRes.body.items[0].marksObtained}/50 in Midterm Exam 1!`);

    // -------------------------------------------------------------
    // TEST 7: Pagination Verification on List Endpoints
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 7: Pagination Verification (?page=&limit=)');
    console.log('-------------------------------------------------------------');
    // Teacher lists attendance with limit=2
    // We have 6 total attendance records in DB for this class (3 students x 2 dates)
    const page1Res = await request({
      method: 'GET',
      path: `/api/attendance/${classId}?page=1&limit=2`,
      headers: { Authorization: `Bearer ${teacherToken}` },
    });

    if (
      page1Res.status !== 200 ||
      page1Res.body.items.length !== 2 ||
      page1Res.body.pagination.total !== 6 ||
      page1Res.body.pagination.totalPages !== 3 ||
      page1Res.body.pagination.hasNextPage !== true ||
      page1Res.body.pagination.hasPrevPage !== false
    ) {
      throw new Error(`Pagination page 1 assertion failed: ${JSON.stringify(page1Res.body.pagination)}`);
    }
    console.log('✔ PASS: Page 1 limit=2 returned 2 items, total=6, totalPages=3, hasNextPage=true, hasPrevPage=false');

    const page3Res = await request({
      method: 'GET',
      path: `/api/attendance/${classId}?page=3&limit=2`,
      headers: { Authorization: `Bearer ${teacherToken}` },
    });

    if (
      page3Res.status !== 200 ||
      page3Res.body.items.length !== 2 ||
      page3Res.body.pagination.hasNextPage !== false ||
      page3Res.body.pagination.hasPrevPage !== true
    ) {
      throw new Error(`Pagination page 3 assertion failed: ${JSON.stringify(page3Res.body.pagination)}`);
    }
    console.log('✔ PASS: Page 3 limit=2 returned 2 items, hasNextPage=false, hasPrevPage=true');

    // -------------------------------------------------------------
    // TEST 8: AI Planner Generation, Caching, and Day Updates
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 8: AI Syllabus Planner Generation & Caching');
    console.log('-------------------------------------------------------------');
    const syllabusText = `
      Unit 1: Distributed Architectures and Communication. RPC, RMI, Message queues.
      Unit 2: Synchronization and Coordination. Clock synchronization, Mutual exclusion, Election algorithms.
      Unit 3: Consistency and Replication. Strict, sequential, eventual consistency.
      Unit 4: Fault Tolerance and Consensus. Byzantine fault tolerance, Paxos, Raft.
      Unit 5: Distributed File Systems. HDFS, GFS, NFS architecture.
    `;

    // 1st call: Generates and caches
    const planGenRes = await request({
      method: 'POST',
      path: '/api/planner/generate',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        extractedSyllabusText: syllabusText,
        numberOfDays: 5,
      },
    });

    if (planGenRes.status !== 201 || planGenRes.body.days.length !== 5) {
      throw new Error(`Plan generation failed: ${JSON.stringify(planGenRes.body)}`);
    }
    console.log(`✔ PASS: Generated 5-day syllabus plan. Cached = ${planGenRes.body.cached}`);

    // 2nd call: Must return CACHED plan immediately
    const cachedPlanRes = await request({
      method: 'POST',
      path: '/api/planner/generate',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        extractedSyllabusText: syllabusText,
        numberOfDays: 5,
        regenerate: false,
      },
    });

    if (cachedPlanRes.status !== 200 || cachedPlanRes.body.cached !== true) {
      throw new Error(`Expected cached plan, got: ${JSON.stringify(cachedPlanRes.body)}`);
    }
    console.log('✔ PASS: Second generate call returned cached plan directly from MongoDB with cached=true!');

    // Update Day 1 to "done"
    const day1 = planGenRes.body.days[0];
    const updateDayRes = await request({
      method: 'PATCH',
      path: '/api/planner/day',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        dayId: day1._id,
        status: 'done',
      },
    });

    if (updateDayRes.status !== 200 || updateDayRes.body.day.status !== 'done') {
      throw new Error(`Update day failed: ${JSON.stringify(updateDayRes.body)}`);
    }
    console.log('✔ PASS: Day 1 updated to status "done"');

    // Student views planner
    const studentPlannerRes = await request({
      method: 'GET',
      path: `/api/planner/${classId}`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    if (studentPlannerRes.status !== 200 || studentPlannerRes.body.doneDays !== 1 || studentPlannerRes.body.completionPercentage !== 20) {
      throw new Error(`Student planner fetch failed: ${JSON.stringify(studentPlannerRes.body)}`);
    }
    console.log(`✔ PASS: Student retrieved planner: 1/5 days done (20.0% completion)`);

    // -------------------------------------------------------------
    // TEST 9: Notices and Read Tracking
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------');
    console.log('TEST 9: Notices & Student Read Tracking');
    console.log('-------------------------------------------------------------');
    const noticeRes = await request({
      method: 'POST',
      path: '/api/notices',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        classId,
        title: 'Project Submission Deadline',
        message: 'All groups must submit their final project report by Friday 5 PM.',
        link: 'https://college.edu/submission-portal',
      },
    });

    if (noticeRes.status !== 201 || !noticeRes.body.notice._id) {
      throw new Error(`Notice creation failed: ${JSON.stringify(noticeRes.body)}`);
    }
    const noticeId = noticeRes.body.notice._id;
    console.log(`✔ PASS: Notice posted by teacher. ID: ${noticeId}`);

    // Student reads notices before marking read
    const noticeList1 = await request({
      method: 'GET',
      path: `/api/notices/${classId}`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    if (noticeList1.body.items[0].isRead !== false) {
      throw new Error('Notice should initially be unread for student');
    }

    // Student marks notice as read
    const markReadRes = await request({
      method: 'POST',
      path: `/api/notices/${noticeId}/read`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    if (markReadRes.status !== 200) {
      throw new Error(`Mark read failed: ${JSON.stringify(markReadRes.body)}`);
    }

    // Student reads notices again - should be marked read
    const noticeList2 = await request({
      method: 'GET',
      path: `/api/notices/${classId}`,
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    if (noticeList2.body.items[0].isRead !== true) {
      throw new Error('Notice should now be marked as read');
    }
    console.log('✔ PASS: Notice read status verified: student marked notice as read.');

    console.log('\n================================================================');
    console.log('ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY! (9/9 SUITES PASSED)');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ TEST FAILED WITH ERROR:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await mongoose.connection.close();
    process.exit(process.exitCode || 0);
  }
};

runTests();

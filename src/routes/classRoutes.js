const express = require('express');
const router = express.Router();
const classController = require('../controllers/classController');
const { authenticate, requireRole } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Student: List enrolled classes (placed before /:classId to prevent route collision)
router.get('/enrolled', requireRole('student'), classController.getEnrolledClasses);

// Student: Request to join a class
router.post('/join-request', requireRole('student'), classController.requestJoinClass);

// Teacher: Approve or reject a join request
router.post('/join-requests/respond', requireRole('teacher'), classController.respondJoinRequest);

// Teacher: Regenerate join code (accepts classId in body or param)
router.post('/regenerate-code', requireRole('teacher'), classController.regenerateJoinCode);
router.post('/:classId/regenerate-code', requireRole('teacher'), classController.regenerateJoinCode);

// Teacher: List join requests for a class (paginated)
router.get('/:classId/join-requests', requireRole('teacher'), classController.listJoinRequests);

// Teacher: Create class
router.post('/', requireRole('teacher'), classController.createClass);

// Teacher: List classes created by teacher
router.get('/', requireRole('teacher'), classController.getTeacherClasses);

// Both: Get single class details
router.get('/:classId', classController.getClassDetails);

module.exports = router;

const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Teacher: Create exam column
router.post('/', requireRole('teacher'), examController.createExam);

// Both Teacher and Enrolled Student: List exams for class
router.get('/:classId', examController.listExams);

module.exports = router;

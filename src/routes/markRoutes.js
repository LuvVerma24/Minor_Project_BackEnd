const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Teacher: Submit marks for an exam
router.post('/', requireRole('teacher'), examController.submitMarks);

// Teacher: Edit marks for a specific student or exam record
router.put('/', requireRole('teacher'), examController.editMarks);

// Both Teacher and Enrolled Student: Get marks (paginated)
router.get('/:classId', examController.getMarks);

module.exports = router;

const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Teacher: Submit today's attendance for list of roll numbers
router.post('/', requireRole('teacher'), attendanceController.submitAttendance);

// Teacher: Edit a specific attendance record
router.put('/', requireRole('teacher'), attendanceController.editAttendance);

// Both Teacher and Enrolled Student: Get attendance history (paginated)
router.get('/:classId', attendanceController.getAttendanceHistory);

module.exports = router;

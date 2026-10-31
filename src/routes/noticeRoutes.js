const express = require('express');
const router = express.Router();
const noticeController = require('../controllers/noticeController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Teacher: Create notice
router.post('/', requireRole('teacher'), noticeController.createNotice);

// Both Teacher and Enrolled Student: List notices for class (paginated)
router.get('/:classId', noticeController.listNotices);

// Student: Mark notice as read
router.post('/:noticeId/read', requireRole('student'), noticeController.markNoticeRead);

module.exports = router;

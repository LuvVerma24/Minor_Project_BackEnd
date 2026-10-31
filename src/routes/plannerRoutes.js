const express = require('express');
const router = express.Router();
const plannerController = require('../controllers/plannerController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate);

// Teacher: Generate or load cached syllabus planner
router.post('/generate', requireRole('teacher'), plannerController.generatePlanner);

// Teacher: Mark planner day status (pending | done | skipped)
router.patch('/day', requireRole('teacher'), plannerController.updateDayStatus);

// Both Teacher and Enrolled Student: Get full planner
router.get('/:classId', plannerController.getPlanner);

module.exports = router;

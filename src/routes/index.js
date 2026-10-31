const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const classRoutes = require('./classRoutes');
const attendanceRoutes = require('./attendanceRoutes');
const examRoutes = require('./examRoutes');
const markRoutes = require('./markRoutes');
const noticeRoutes = require('./noticeRoutes');
const plannerRoutes = require('./plannerRoutes');

// API Health Check (also mounted at root /health in app.js)
router.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Register subroutes
router.use('/auth', authRoutes);
router.use('/classes', classRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/exams', examRoutes);
router.use('/marks', markRoutes);
router.use('/notices', noticeRoutes);
router.use('/planner', plannerRoutes);

module.exports = router;

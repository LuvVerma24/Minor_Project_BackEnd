const PlannerDay = require('../models/PlannerDay');
const ClassRoom = require('../models/ClassRoom');
const Enrollment = require('../models/Enrollment');
const { generateSyllabusPlan } = require('../services/groqService');

/**
 * TEACHER: Generate or retrieve AI Syllabus Planner
 * Caches immediately in MongoDB; does not call Groq if plan already exists unless regenerate === true
 */
const generatePlanner = async (req, res, next) => {
  try {
    const { classId, extractedSyllabusText, numberOfDays, regenerate = false } = req.body;

    if (!classId || !extractedSyllabusText || !numberOfDays) {
      return res.status(400).json({
        success: false,
        message: 'classId, extractedSyllabusText, and numberOfDays are required.',
      });
    }

    const classroom = await ClassRoom.findOne({
      _id: classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: 'Classroom not found or you are not authorized to manage its planner.',
      });
    }

    const daysCount = parseInt(numberOfDays, 10);
    if (isNaN(daysCount) || daysCount < 1) {
      return res.status(400).json({
        success: false,
        message: 'numberOfDays must be a positive integer.',
      });
    }

    // Check if planner days already exist for this class
    const existingDays = await PlannerDay.find({ classId }).sort({ dayNumber: 1 });

    // If plan already exists and teacher did not explicitly ask to regenerate, return cached plan immediately!
    if (existingDays.length > 0 && !regenerate) {
      return res.status(200).json({
        success: true,
        message: 'Existing planner loaded from cache.',
        cached: true,
        classId,
        days: existingDays,
      });
    }

    // Call Groq API with 3x retry and exponential backoff
    const generatedDays = await generateSyllabusPlan(extractedSyllabusText, daysCount);

    // If regenerating, clear previous plan days
    if (existingDays.length > 0) {
      await PlannerDay.deleteMany({ classId });
    }

    // Immediately cache generated plan in MongoDB
    const docsToInsert = generatedDays.map((item) => ({
      classId,
      dayNumber: item.dayNumber,
      topic: item.topic,
      status: 'pending',
    }));

    const savedDays = await PlannerDay.insertMany(docsToInsert);

    return res.status(201).json({
      success: true,
      message: 'AI Syllabus Plan generated and cached successfully.',
      cached: false,
      classId,
      days: savedDays,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * BOTH: Get full syllabus planner for a class
 */
const getPlanner = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const classroom = await ClassRoom.findById(classId);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found.',
      });
    }

    // Check authorization: teacher or enrolled student
    if (req.user.role === 'student') {
      const isEnrolled = await Enrollment.findOne({ classId, studentId: req.user.id });
      if (!isEnrolled) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You are not enrolled in this class.',
        });
      }
    } else if (classroom.facultyId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You do not teach this class.',
      });
    }

    const days = await PlannerDay.find({ classId }).sort({ dayNumber: 1 });

    const totalDays = days.length;
    const doneDays = days.filter((d) => d.status === 'done').length;
    const skippedDays = days.filter((d) => d.status === 'skipped').length;
    const pendingDays = days.filter((d) => d.status === 'pending').length;
    const completionPercentage = totalDays > 0 ? ((doneDays / totalDays) * 100).toFixed(1) : 0;

    return res.status(200).json({
      success: true,
      classId,
      totalDays,
      doneDays,
      skippedDays,
      pendingDays,
      completionPercentage: Number(completionPercentage),
      days,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: Mark planner day status (pending | done | skipped)
 */
const updateDayStatus = async (req, res, next) => {
  try {
    const { classId, dayId, dayNumber, status } = req.body;

    if (!classId || (!dayId && dayNumber === undefined) || !status) {
      return res.status(400).json({
        success: false,
        message: 'classId, dayId (or dayNumber), and status ("pending", "done", "skipped") are required.',
      });
    }

    const cleanStatus = status.toString().trim().toLowerCase();
    if (!['pending', 'done', 'skipped'].includes(cleanStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be one of: "pending", "done", "skipped".',
      });
    }

    const classroom = await ClassRoom.findOne({
      _id: classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: 'Classroom not found or you are not authorized to update its planner.',
      });
    }

    const query = { classId };
    if (dayId) {
      query._id = dayId;
    } else {
      query.dayNumber = parseInt(dayNumber, 10);
    }

    const updatedDay = await PlannerDay.findOneAndUpdate(
      query,
      { $set: { status: cleanStatus } },
      { returnDocument: 'after' }
    );

    if (!updatedDay) {
      return res.status(404).json({
        success: false,
        message: 'Planner day not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Day ${updatedDay.dayNumber} marked as ${cleanStatus}.`,
      day: updatedDay,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generatePlanner,
  getPlanner,
  updateDayStatus,
};

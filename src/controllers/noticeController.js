const Notice = require('../models/Notice');
const ClassRoom = require('../models/ClassRoom');
const Enrollment = require('../models/Enrollment');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

/**
 * TEACHER: Create a class notice
 */
const createNotice = async (req, res, next) => {
  try {
    const { classId, title, message, link } = req.body;

    if (!classId || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'classId, title, and message are required.',
      });
    }

    const classroom = await ClassRoom.findOne({
      _id: classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: 'Classroom not found or you are not authorized to post notices here.',
      });
    }

    const notice = await Notice.create({
      classId,
      title: title.trim(),
      message: message.trim(),
      link: link ? link.trim() : null,
      readBy: [],
    });

    return res.status(201).json({
      success: true,
      message: 'Notice created successfully.',
      notice,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * BOTH: List notices for a class (paginated)
 */
const listNotices = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const classroom = await ClassRoom.findById(classId);

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found.',
      });
    }

    // Access check: teacher or enrolled student
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
        message: 'Access denied: You are not the instructor for this class.',
      });
    }

    const { page, limit, skip } = getPagination(req.query, 20);

    const [total, notices] = await Promise.all([
      Notice.countDocuments({ classId }),
      Notice.find({ classId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    // Format notices to indicate read status for students
    const formatted = notices.map((n) => {
      const obj = n.toObject();
      obj.isRead = req.user.role === 'student' ? n.readBy.some((id) => id.toString() === req.user.id) : null;
      obj.readCount = n.readBy.length;
      return obj;
    });

    return res.status(200).json({
      success: true,
      ...buildPaginatedResponse(formatted, total, page, limit),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * STUDENT: Mark notice as read
 */
const markNoticeRead = async (req, res, next) => {
  try {
    const { noticeId } = req.params;

    const notice = await Notice.findById(noticeId);
    if (!notice) {
      return res.status(404).json({
        success: false,
        message: 'Notice not found.',
      });
    }

    // Verify student is enrolled in this class
    const isEnrolled = await Enrollment.findOne({
      classId: notice.classId,
      studentId: req.user.id,
    });

    if (!isEnrolled) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: You are not enrolled in the class for this notice.',
      });
    }

    // Add student to readBy array if not already present
    await Notice.findByIdAndUpdate(noticeId, {
      $addToSet: { readBy: req.user.id },
    });

    return res.status(200).json({
      success: true,
      message: 'Notice marked as read.',
      noticeId,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createNotice,
  listNotices,
  markNoticeRead,
};

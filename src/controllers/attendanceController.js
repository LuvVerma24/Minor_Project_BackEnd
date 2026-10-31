const Attendance = require('../models/Attendance');
const ClassRoom = require('../models/ClassRoom');
const Enrollment = require('../models/Enrollment');
const { normalizeDate } = require('../utils/helpers');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

/**
 * TEACHER: Submit daily attendance for a list of roll numbers
 * Zero dependency on student accounts existing!
 */
const submitAttendance = async (req, res, next) => {
  try {
    const { classId, date, records } = req.body;

    if (!classId || !records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'classId and a non-empty records array of { rollNo, status } are required.',
      });
    }

    // Verify teacher owns the class
    const classroom = await ClassRoom.findOne({
      _id: classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: 'Classroom not found or you are not authorized to submit attendance for it.',
      });
    }

    const attendanceDate = normalizeDate(date);

    // Validate records
    const bulkOps = [];
    const validRollNos = new Set();

    for (const record of records) {
      if (!record.rollNo || !record.status) {
        return res.status(400).json({
          success: false,
          message: 'Each record must contain rollNo and status ("present" or "absent").',
        });
      }

      const roll = record.rollNo.toString().trim();
      const status = record.status.toString().trim().toLowerCase();

      if (!['present', 'absent'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status "${record.status}" for rollNo ${roll}. Must be "present" or "absent".`,
        });
      }

      validRollNos.add(roll);

      bulkOps.push({
        updateOne: {
          filter: {
            classId,
            rollNo: roll,
            date: attendanceDate,
          },
          update: {
            $set: {
              status,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
    }

    if (bulkOps.length > 0) {
      await Attendance.bulkWrite(bulkOps);
    }

    return res.status(200).json({
      success: true,
      message: `Attendance recorded successfully for ${bulkOps.length} students.`,
      date: attendanceDate,
      processedCount: bulkOps.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: Edit a single attendance record
 */
const editAttendance = async (req, res, next) => {
  try {
    const { classId, rollNo, date, status } = req.body;

    if (!classId || !rollNo || !date || !status) {
      return res.status(400).json({
        success: false,
        message: 'classId, rollNo, date, and status are all required.',
      });
    }

    const classroom = await ClassRoom.findOne({
      _id: classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: 'Classroom not found or you are not authorized to edit its attendance.',
      });
    }

    const cleanStatus = status.toString().trim().toLowerCase();
    if (!['present', 'absent'].includes(cleanStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "present" or "absent".',
      });
    }

    const attendanceDate = normalizeDate(date);
    const cleanRollNo = rollNo.toString().trim();

    const updated = await Attendance.findOneAndUpdate(
      { classId, rollNo: cleanRollNo, date: attendanceDate },
      { $set: { status: cleanStatus } },
      { returnDocument: 'after', upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Attendance record updated successfully.',
      attendance: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * LIST ATTENDANCE HISTORY (Paginated)
 * Teachers can view entire class or filter by date/rollNo.
 * Students only see their own attendance linked by their enrolled roll number.
 */
const getAttendanceHistory = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { date, rollNo } = req.query;

    const classroom = await ClassRoom.findById(classId);
    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found.',
      });
    }

    const filter = { classId };

    // Teacher check
    const isTeacher = req.user.role === 'teacher' && classroom.facultyId.toString() === req.user.id;

    if (isTeacher) {
      // Teacher can filter optionally
      if (date) {
        filter.date = normalizeDate(date);
      }
      if (rollNo) {
        filter.rollNo = rollNo.toString().trim();
      }
    } else {
      // Student check: must be enrolled
      const enrollment = await Enrollment.findOne({
        classId,
        studentId: req.user.id,
      });

      if (!enrollment) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You are not enrolled in this class.',
        });
      }

      // CRITICAL: Strictly bind student query to their linked rollNo
      filter.rollNo = enrollment.rollNo;
      if (date) {
        filter.date = normalizeDate(date);
      }
    }

    const { page, limit, skip } = getPagination(req.query, 20);

    const [total, records] = await Promise.all([
      Attendance.countDocuments(filter),
      Attendance.find(filter).sort({ date: -1, rollNo: 1 }).skip(skip).limit(limit),
    ]);

    // If student, compute summary stats
    let studentSummary = null;
    if (!isTeacher && req.user.role === 'student') {
      const allStudentRecords = await Attendance.find({ classId, rollNo: filter.rollNo });
      const totalClasses = allStudentRecords.length;
      const presentCount = allStudentRecords.filter((r) => r.status === 'present').length;
      const absentCount = totalClasses - presentCount;
      const percentage = totalClasses > 0 ? ((presentCount / totalClasses) * 100).toFixed(1) : 0;

      studentSummary = {
        rollNo: filter.rollNo,
        totalClasses,
        presentClasses: presentCount,
        absentClasses: absentCount,
        percentage: Number(percentage),
      };
    }

    return res.status(200).json({
      success: true,
      studentSummary,
      ...buildPaginatedResponse(records, total, page, limit),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitAttendance,
  editAttendance,
  getAttendanceHistory,
};

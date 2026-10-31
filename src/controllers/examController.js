const Exam = require('../models/Exam');
const Mark = require('../models/Mark');
const ClassRoom = require('../models/ClassRoom');
const Enrollment = require('../models/Enrollment');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

/**
 * TEACHER: Create exam column for a class
 */
const createExam = async (req, res, next) => {
  try {
    const { classId, examName, maxMarks } = req.body;

    if (!classId || !examName || maxMarks === undefined) {
      return res.status(400).json({
        success: false,
        message: 'classId, examName, and maxMarks are required.',
      });
    }

    const marksLimit = Number(maxMarks);
    if (isNaN(marksLimit) || marksLimit <= 0) {
      return res.status(400).json({
        success: false,
        message: 'maxMarks must be a positive number greater than 0.',
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
        message: 'Classroom not found or you are not authorized to create exams for it.',
      });
    }

    const exam = await Exam.create({
      classId,
      examName: examName.trim(),
      maxMarks: marksLimit,
    });

    return res.status(201).json({
      success: true,
      message: 'Exam column created successfully.',
      exam,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * BOTH: List exams for a class (paginated)
 */
const listExams = async (req, res, next) => {
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
      const enrolled = await Enrollment.findOne({ classId, studentId: req.user.id });
      if (!enrolled) {
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

    const { page, limit, skip } = getPagination(req.query, 20);

    const [total, exams] = await Promise.all([
      Exam.countDocuments({ classId }),
      Exam.find({ classId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    return res.status(200).json({
      success: true,
      ...buildPaginatedResponse(exams, total, page, limit),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: Submit marks for an exam
 * Completely decoupled from student accounts! Keys by (classId, examId, rollNo).
 */
const submitMarks = async (req, res, next) => {
  try {
    const { classId, examId, records } = req.body;

    if (!classId || !examId || !records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'classId, examId, and non-empty records array of { rollNo, marksObtained } are required.',
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
        message: 'Classroom not found or you are not authorized to enter marks for it.',
      });
    }

    // Verify exam exists and belongs to this class
    const exam = await Exam.findOne({ _id: examId, classId });
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found for this classroom.',
      });
    }

    // Validate each record
    const bulkOps = [];
    for (const record of records) {
      if (!record.rollNo || record.marksObtained === undefined || record.marksObtained === null) {
        return res.status(400).json({
          success: false,
          message: 'Each record must have a rollNo and marksObtained.',
        });
      }

      const roll = record.rollNo.toString().trim();
      const obtained = Number(record.marksObtained);

      if (isNaN(obtained) || obtained < 0) {
        return res.status(400).json({
          success: false,
          message: `Marks obtained for rollNo ${roll} cannot be negative.`,
        });
      }

      if (obtained > exam.maxMarks) {
        return res.status(400).json({
          success: false,
          message: `Marks obtained (${obtained}) for rollNo ${roll} exceeds maximum marks allowed (${exam.maxMarks}) for ${exam.examName}.`,
        });
      }

      bulkOps.push({
        updateOne: {
          filter: {
            classId,
            examId,
            rollNo: roll,
          },
          update: {
            $set: {
              marksObtained: obtained,
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
      await Mark.bulkWrite(bulkOps);
    }

    return res.status(200).json({
      success: true,
      message: `Marks recorded successfully for ${bulkOps.length} students in ${exam.examName}.`,
      examId,
      examName: exam.examName,
      maxMarks: exam.maxMarks,
      processedCount: bulkOps.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * LIST MARKS (Paginated)
 * Teachers can view entire class or filter by examId/rollNo.
 * Students only see their own marks linked by their enrolled roll number.
 */
const getMarks = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { examId, rollNo } = req.query;

    const classroom = await ClassRoom.findById(classId);
    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found.',
      });
    }

    const filter = { classId };

    const isTeacher = req.user.role === 'teacher' && classroom.facultyId.toString() === req.user.id;

    if (isTeacher) {
      if (examId) filter.examId = examId;
      if (rollNo) filter.rollNo = rollNo.toString().trim();
    } else {
      // Student must be enrolled
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

      // CRITICAL: Force student's enrolled rollNo
      filter.rollNo = enrollment.rollNo;
      if (examId) filter.examId = examId;
    }

    const { page, limit, skip } = getPagination(req.query, 20);

    const [total, marks] = await Promise.all([
      Mark.countDocuments(filter),
      Mark.find(filter)
        .populate('examId', 'examName maxMarks')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    return res.status(200).json({
      success: true,
      ...buildPaginatedResponse(marks, total, page, limit),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: Edit marks for a specific student record
 * Matches the pattern of editAttendance: accepts { classId, examId, rollNo, marksObtained }
 * or { markId, marksObtained }
 */
const editMarks = async (req, res, next) => {
  try {
    const { classId, examId, rollNo, marksObtained, markId } = req.body;

    let targetClassId = classId;
    let targetExamId = examId;
    let targetRollNo = rollNo;

    // If markId is provided, look up the existing Mark first
    if (markId) {
      const existingMark = await Mark.findById(markId);
      if (!existingMark) {
        return res.status(404).json({
          success: false,
          message: 'Mark record not found.',
        });
      }
      targetClassId = existingMark.classId;
      targetExamId = existingMark.examId;
      targetRollNo = existingMark.rollNo;
    }

    if (!targetClassId || !targetExamId || !targetRollNo || marksObtained === undefined || marksObtained === null) {
      return res.status(400).json({
        success: false,
        message: 'classId, examId, rollNo, and marksObtained are all required (or markId and marksObtained).',
      });
    }

    // Verify teacher owns the class
    const classroom = await ClassRoom.findOne({
      _id: targetClassId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: 'Classroom not found or you are not authorized to edit marks for it.',
      });
    }

    // Verify exam exists and belongs to this class
    const exam = await Exam.findOne({ _id: targetExamId, classId: targetClassId });
    if (!exam) {
      return res.status(404).json({
        success: false,
        message: 'Exam not found for this classroom.',
      });
    }

    const obtained = Number(marksObtained);
    if (isNaN(obtained) || obtained < 0) {
      return res.status(400).json({
        success: false,
        message: 'marksObtained must be a non-negative number.',
      });
    }

    if (obtained > exam.maxMarks) {
      return res.status(400).json({
        success: false,
        message: `marksObtained (${obtained}) exceeds maximum marks (${exam.maxMarks}) allowed for ${exam.examName}.`,
      });
    }

    const cleanRollNo = targetRollNo.toString().trim();

    const updated = await Mark.findOneAndUpdate(
      { classId: targetClassId, examId: targetExamId, rollNo: cleanRollNo },
      {
        $set: {
          marksObtained: obtained,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { returnDocument: 'after', upsert: true }
    ).populate('examId', 'examName maxMarks');

    return res.status(200).json({
      success: true,
      message: `Marks updated to ${obtained}/${exam.maxMarks} for rollNo "${cleanRollNo}" in ${exam.examName}.`,
      record: updated,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createExam,
  listExams,
  submitMarks,
  editMarks,
  getMarks,
};

const ClassRoom = require('../models/ClassRoom');
const JoinRequest = require('../models/JoinRequest');
const Enrollment = require('../models/Enrollment');
const User = require('../models/User');
const { generateUniqueJoinCode } = require('../utils/helpers');
const { getPagination, buildPaginatedResponse } = require('../utils/pagination');

/**
 * TEACHER: Create a new classroom
 * Server generates joinCode automatically
 */
const createClass = async (req, res, next) => {
  try {
    const { subjectName, numberOfStudents, department, year, section } = req.body;

    if (!subjectName || !numberOfStudents || !department || !year || !section) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: subjectName, numberOfStudents, department, year, section.',
      });
    }

    const numStudents = parseInt(numberOfStudents, 10);
    if (isNaN(numStudents) || numStudents < 1) {
      return res.status(400).json({
        success: false,
        message: 'numberOfStudents must be a positive number.',
      });
    }

    // Server generates joinCode automatically - never accept from client
    const joinCode = await generateUniqueJoinCode();

    const classroom = await ClassRoom.create({
      facultyId: req.user.id,
      subjectName: subjectName.trim(),
      numberOfStudents: numStudents,
      department: department.trim(),
      year: year.trim(),
      section: section.trim(),
      joinCode,
    });

    return res.status(201).json({
      success: true,
      message: 'Classroom created successfully.',
      classroom,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: Regenerate classroom join code
 */
const regenerateJoinCode = async (req, res, next) => {
  try {
    const classId = req.params.classId || req.body.classId;

    if (!classId) {
      return res.status(400).json({
        success: false,
        message: 'classId is required.',
      });
    }

    const classroom = await ClassRoom.findOne({
      _id: classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found or you are not authorized to modify it.',
      });
    }

    const newJoinCode = await generateUniqueJoinCode();
    classroom.joinCode = newJoinCode;
    await classroom.save();

    return res.status(200).json({
      success: true,
      message: 'Join code regenerated successfully.',
      joinCode: newJoinCode,
      classroom,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * STUDENT: Request to join a class using classId or joinCode
 */
const requestJoinClass = async (req, res, next) => {
  try {
    const { classId, joinCode, year, department, scholarNo, rollNo } = req.body;

    if (!year || !department || !scholarNo || !rollNo) {
      return res.status(400).json({
        success: false,
        message: 'year, department, scholarNo, and rollNo are all required.',
      });
    }

    if (!classId && !joinCode) {
      return res.status(400).json({
        success: false,
        message: 'Either classId or joinCode must be provided to join a class.',
      });
    }

    // Lookup classroom
    let classroom;
    if (joinCode) {
      classroom = await ClassRoom.findOne({ joinCode: joinCode.trim().toUpperCase() });
    } else {
      classroom = await ClassRoom.findById(classId);
    }

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found with the provided identifier.',
      });
    }

    const targetClassId = classroom._id;
    const cleanRollNo = rollNo.trim();
    const cleanScholarNo = scholarNo.trim();

    // Check if student is already enrolled in this class
    const existingEnrollment = await Enrollment.findOne({
      classId: targetClassId,
      studentId: req.user.id,
    });

    if (existingEnrollment) {
      return res.status(400).json({
        success: false,
        message: `You are already enrolled in this class with roll number ${existingEnrollment.rollNo}.`,
      });
    }

    // Check if this roll number is already claimed by someone else in this class
    const rollClaimed = await Enrollment.findOne({
      classId: targetClassId,
      rollNo: cleanRollNo,
    });

    if (rollClaimed) {
      return res.status(400).json({
        success: false,
        message: `Roll number ${cleanRollNo} is already registered to another student in this class.`,
      });
    }

    // Check if there is already a pending join request for this student
    const existingRequest = await JoinRequest.findOne({
      classId: targetClassId,
      studentId: req.user.id,
      status: 'pending',
    });

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending join request for this class.',
      });
    }

    // Create new join request
    const joinRequest = await JoinRequest.create({
      classId: targetClassId,
      studentId: req.user.id,
      rollNo: cleanRollNo,
      scholarNo: cleanScholarNo,
      status: 'pending',
    });

    return res.status(201).json({
      success: true,
      message: 'Join request submitted successfully. Awaiting teacher approval.',
      joinRequest,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: List join requests for a class (paginated)
 */
const listJoinRequests = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const { status } = req.query;

    const classroom = await ClassRoom.findOne({
      _id: classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found or you are not authorized to view its join requests.',
      });
    }

    const filter = { classId };
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      filter.status = status;
    }

    const { page, limit, skip } = getPagination(req.query, 20);

    const [total, requests] = await Promise.all([
      JoinRequest.countDocuments(filter),
      JoinRequest.find(filter)
        .populate('studentId', 'fullName email phone department year section')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
    ]);

    return res.status(200).json({
      success: true,
      ...buildPaginatedResponse(requests, total, page, limit),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: Approve or Reject a Join Request
 */
const respondJoinRequest = async (req, res, next) => {
  try {
    const { joinRequestId, action } = req.body;

    if (!joinRequestId || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'joinRequestId and action ("approve" or "reject") are required.',
      });
    }

    const joinRequest = await JoinRequest.findById(joinRequestId);
    if (!joinRequest) {
      return res.status(404).json({
        success: false,
        message: 'Join request not found.',
      });
    }

    // Verify teacher owns the classroom
    const classroom = await ClassRoom.findOne({
      _id: joinRequest.classId,
      facultyId: req.user.id,
    });

    if (!classroom) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: you are not the faculty for this class.',
      });
    }

    if (joinRequest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This join request has already been ${joinRequest.status}.`,
      });
    }

    if (action === 'reject') {
      joinRequest.status = 'rejected';
      await joinRequest.save();

      return res.status(200).json({
        success: true,
        message: 'Join request rejected.',
        joinRequest,
      });
    }

    // Action is "approve"
    // Check if roll number was taken in the meantime
    const existingEnrollment = await Enrollment.findOne({
      classId: joinRequest.classId,
      rollNo: joinRequest.rollNo,
    });

    if (existingEnrollment) {
      return res.status(409).json({
        success: false,
        message: `Cannot approve: Roll number ${joinRequest.rollNo} is already assigned to another student.`,
      });
    }

    // Update request status
    joinRequest.status = 'approved';
    await joinRequest.save();

    // Create Enrollment record (links student account to roll number)
    const enrollment = await Enrollment.create({
      classId: joinRequest.classId,
      studentId: joinRequest.studentId,
      rollNo: joinRequest.rollNo,
    });

    return res.status(200).json({
      success: true,
      message: 'Join request approved. Student enrolled successfully.',
      joinRequest,
      enrollment,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * TEACHER: List all classes taught by teacher
 */
const getTeacherClasses = async (req, res, next) => {
  try {
    const classes = await ClassRoom.find({ facultyId: req.user.id }).sort({ createdAt: -1 });

    // Attach student enrollment count and pending request count
    const enrichedClasses = await Promise.all(
      classes.map(async (c) => {
        const [enrolledCount, pendingCount] = await Promise.all([
          Enrollment.countDocuments({ classId: c._id }),
          JoinRequest.countDocuments({ classId: c._id, status: 'pending' }),
        ]);

        return {
          ...c.toObject(),
          enrolledCount,
          pendingRequestsCount: pendingCount,
        };
      })
    );

    return res.status(200).json({
      success: true,
      classes: enrichedClasses,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * STUDENT: List all classes student is enrolled in
 */
const getEnrolledClasses = async (req, res, next) => {
  try {
    const enrollments = await Enrollment.find({ studentId: req.user.id })
      .populate({
        path: 'classId',
        populate: { path: 'facultyId', select: 'fullName email department post' },
      })
      .sort({ createdAt: -1 });

    const classes = enrollments
      .filter((e) => e.classId) // guard against deleted classes
      .map((e) => ({
        enrollmentId: e._id,
        rollNo: e.rollNo,
        enrolledAt: e.createdAt,
        classroom: e.classId,
      }));

    return res.status(200).json({
      success: true,
      classes,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * BOTH: Get single classroom details
 */
const getClassDetails = async (req, res, next) => {
  try {
    const { classId } = req.params;
    const classroom = await ClassRoom.findById(classId).populate('facultyId', 'fullName email department post');

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found.',
      });
    }

    let userRoleInClass = 'none';
    let enrolledRollNo = null;

    if (req.user.role === 'teacher' && classroom.facultyId._id.toString() === req.user.id) {
      userRoleInClass = 'faculty';
    } else if (req.user.role === 'student') {
      const enrollment = await Enrollment.findOne({
        classId: classroom._id,
        studentId: req.user.id,
      });
      if (enrollment) {
        userRoleInClass = 'enrolled_student';
        enrolledRollNo = enrollment.rollNo;
      }
    }

    const [enrolledCount, totalPending] = await Promise.all([
      Enrollment.countDocuments({ classId: classroom._id }),
      userRoleInClass === 'faculty' ? JoinRequest.countDocuments({ classId: classroom._id, status: 'pending' }) : 0,
    ]);

    return res.status(200).json({
      success: true,
      classroom,
      enrolledCount,
      pendingRequestsCount: totalPending,
      userRoleInClass,
      enrolledRollNo,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createClass,
  regenerateJoinCode,
  requestJoinClass,
  listJoinRequests,
  respondJoinRequest,
  getTeacherClasses,
  getEnrolledClasses,
  getClassDetails,
};

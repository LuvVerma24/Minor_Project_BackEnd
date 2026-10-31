const mongoose = require('mongoose');

const joinRequestSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      required: [true, 'Class ID is required'],
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Student ID is required'],
    },
    rollNo: {
      type: String,
      required: [true, 'Roll number is required'],
      trim: true,
    },
    scholarNo: {
      type: String,
      required: [true, 'Scholar number is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

// Required index: JoinRequest on (classId, status)
joinRequestSchema.index({ classId: 1, status: 1 });
joinRequestSchema.index({ classId: 1, studentId: 1 });

module.exports = mongoose.model('JoinRequest', joinRequestSchema);

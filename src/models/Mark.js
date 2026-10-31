const mongoose = require('mongoose');

const markSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      required: [true, 'Class ID is required'],
      index: true,
    },
    examId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Exam',
      required: [true, 'Exam ID is required'],
      index: true,
    },
    rollNo: {
      type: String,
      required: [true, 'Roll number is required'],
      trim: true,
    },
    marksObtained: {
      type: Number,
      required: [true, 'Marks obtained is required'],
      min: [0, 'Marks obtained cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

// Required index: Mark on (classId, examId, rollNo) compound
// Ensures each roll number has only one marks record per exam
markSchema.index({ classId: 1, examId: 1, rollNo: 1 }, { unique: true });

module.exports = mongoose.model('Mark', markSchema);

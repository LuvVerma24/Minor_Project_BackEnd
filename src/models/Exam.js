const mongoose = require('mongoose');

const examSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      required: [true, 'Class ID is required'],
      index: true,
    },
    examName: {
      type: String,
      required: [true, 'Exam name is required'],
      trim: true,
    },
    maxMarks: {
      type: Number,
      required: [true, 'Maximum marks is required'],
      min: [1, 'Maximum marks must be at least 1'],
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate exam names in the same class
examSchema.index({ classId: 1, examName: 1 });

module.exports = mongoose.model('Exam', examSchema);

const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      required: [true, 'Class ID is required'],
      index: true,
    },
    rollNo: {
      type: String,
      required: [true, 'Roll number is required'],
      trim: true,
    },
    date: {
      type: String, // Normalized ISO date string (YYYY-MM-DD)
      required: [true, 'Date is required (YYYY-MM-DD)'],
    },
    status: {
      type: String,
      enum: ['present', 'absent'],
      required: [true, 'Attendance status must be present or absent'],
    },
  },
  {
    timestamps: true,
  }
);

// Required index: Attendance on (classId, rollNo, date) compound
// Ensures each rollNo has only one record per date per class
attendanceSchema.index({ classId: 1, rollNo: 1, date: 1 }, { unique: true });
attendanceSchema.index({ classId: 1, date: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);

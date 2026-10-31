const mongoose = require('mongoose');

const plannerDaySchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      required: [true, 'Class ID is required'],
      index: true,
    },
    dayNumber: {
      type: Number,
      required: [true, 'Day number is required'],
      min: 1,
    },
    topic: {
      type: String,
      required: [true, 'Topic is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'done', 'skipped'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

plannerDaySchema.index({ classId: 1, dayNumber: 1 }, { unique: true });

module.exports = mongoose.model('PlannerDay', plannerDaySchema);

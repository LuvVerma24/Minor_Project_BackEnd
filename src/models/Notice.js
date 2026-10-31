const mongoose = require('mongoose');

const noticeSchema = new mongoose.Schema(
  {
    classId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClassRoom',
      required: [true, 'Class ID is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Notice title is required'],
      trim: true,
    },
    message: {
      type: String,
      required: [true, 'Notice message is required'],
      trim: true,
    },
    link: {
      type: String,
      trim: true,
      default: null,
    },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

noticeSchema.index({ classId: 1, createdAt: -1 });

module.exports = mongoose.model('Notice', noticeSchema);

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    role: {
      type: String,
      enum: ['teacher', 'student'],
      required: [true, 'Role is required (teacher or student)'],
      index: true,
    },
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true,
    },
    // Student specific fields
    year: {
      type: String,
      trim: true,
      default: null,
    },
    section: {
      type: String,
      trim: true,
      default: null,
    },
    // Teacher specific fields
    post: {
      type: String,
      trim: true,
      default: null, // Designation (e.g. Professor, Assistant Professor)
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Helper method to strip passwordHash from JSON responses
userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.passwordHash;
  return user;
};

module.exports = mongoose.model('User', userSchema);

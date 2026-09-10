const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['admin', 'hod', 'faculty', 'student'],
    required: true
  },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
  // Student-specific fields
  rollNumber: { type: String, sparse: true },
  semester: { type: Number },
  batch: { type: String }, // e.g., "2022-2026"
  section: { type: String },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

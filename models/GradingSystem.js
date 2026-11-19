const mongoose = require('mongoose');

const gradeRangeSchema = new mongoose.Schema({
  grade: { type: String, required: true, uppercase: true, trim: true },
  description: { type: String, default: '' },
  minMark: { type: Number, required: true, min: 0, max: 100 },
  maxMark: { type: Number, required: true, min: 0, max: 100 },
  gradePoint: { type: Number, default: 0, min: 0, max: 10 }
}, { _id: false });

const gradingSystemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  description: { type: String, default: '' },
  isDefault: { type: Boolean, default: false },
  grades: [gradeRangeSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('GradingSystem', gradingSystemSchema);

const mongoose = require('mongoose');

const coSchema = new mongoose.Schema({
  coNumber: { type: String, required: true }, // CO1, CO2, ...
  description: { type: String, required: true },
  blooms: {
    type: String,
    enum: ['Remember', 'Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'],
    default: 'Understand'
  }
});

const assessmentWeightSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['CAT1', 'CAT2', 'Model', 'Assignment', 'Lab', 'Seminar'],
    required: true
  },
  maxMarks: { type: Number, required: true },
  weightage: { type: Number, required: true } // percentage contribution
});

const courseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  semester: { type: Number, required: true, min: 1, max: 8 },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  batch: { type: String, required: true }, // e.g., "2022-2026"
  section: { type: String, default: 'A' },
  academicYear: { type: String, required: true }, // e.g., "2024-25"
  courseType: {
    type: String,
    enum: ['Theory', 'Lab', 'Theory+Lab'],
    default: 'Theory'
  },
  totalCOs: { type: Number, default: 5 },
  totalPOs: { type: Number, default: 12 },
  totalPSOs: { type: Number, default: 2 },
  cos: [coSchema],
  assessmentWeights: [assessmentWeightSchema],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);

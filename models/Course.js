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

const gradeRangeSchema = new mongoose.Schema({
  grade: { type: String, required: true },
  description: { type: String, default: '' },
  minMark: { type: Number, required: true },
  maxMark: { type: Number, required: true },
  gradePoint: { type: Number, default: 0 }
}, { _id: false });

const gradingSystemSchema = new mongoose.Schema({
  systemKey: { type: String, default: 'anna_univ_r2021' },
  systemName: { type: String, default: 'Anna University R2021 (10-Point Letter Grade)' },
  grades: [gradeRangeSchema]
}, { _id: false });

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
  gradingSystem: {
    type: gradingSystemSchema,
    default: () => ({
      systemKey: 'anna_univ_r2021',
      systemName: 'Anna University R2021 (10-Point Letter Grade)',
      grades: [
        { grade: 'O', description: 'Outstanding', minMark: 91, maxMark: 100, gradePoint: 10 },
        { grade: 'A+', description: 'Excellent', minMark: 81, maxMark: 90, gradePoint: 9 },
        { grade: 'A', description: 'Very Good', minMark: 71, maxMark: 80, gradePoint: 8 },
        { grade: 'B+', description: 'Good', minMark: 61, maxMark: 70, gradePoint: 7 },
        { grade: 'B', description: 'Average', minMark: 50, maxMark: 60, gradePoint: 6 },
        { grade: 'C', description: 'Pass', minMark: 45, maxMark: 49, gradePoint: 5 },
        { grade: 'U', description: 'Re-Appear / Fail', minMark: 0, maxMark: 44, gradePoint: 0 },
        { grade: 'AB', description: 'Absent', minMark: 0, maxMark: 0, gradePoint: 0 }
      ]
    })
  },
  regulation: { type: mongoose.Schema.Types.ObjectId, ref: 'AttainmentTemplate' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);

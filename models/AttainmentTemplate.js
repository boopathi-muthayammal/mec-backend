const mongoose = require('mongoose');

const attainmentTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // e.g. "Regulation 2021 (R2021)"
  code: { type: String, required: true, uppercase: true, trim: true }, // e.g. "R2021"
  description: { type: String, default: '' },
  
  // Direct vs Indirect Assessment weightage (Total = 100%)
  directWeight: { type: Number, default: 80, min: 0, max: 100 },
  indirectWeight: { type: Number, default: 20, min: 0, max: 100 },
  
  // Internal vs External Exam weightage (Total = 100%)
  internalWeight: { type: Number, default: 40, min: 0, max: 100 },
  endSemWeight: { type: Number, default: 60, min: 0, max: 100 },
  
  // Student Benchmark Threshold: Minimum % mark a student must score to be considered "Attained"
  thresholdScorePercent: { type: Number, default: 60, min: 0, max: 100 },
  
  // Attainment Levels mapping (% of students who achieved the benchmark)
  level3Threshold: { type: Number, default: 80, min: 0, max: 100 }, // Level 3 if >= 80% students
  level2Threshold: { type: Number, default: 70, min: 0, max: 100 }, // Level 2 if >= 70% students
  level1Threshold: { type: Number, default: 60, min: 0, max: 100 }, // Level 1 if >= 60% students
  
  // Assessment components (e.g. CAT1, CAT2, Unit Tests, Model, Assignments, Lab, Seminar, Viva)
  assessmentComponents: [{
    name: { type: String, required: true },
    type: { type: String, default: 'Internal' },
    maxMarks: { type: Number, default: 50 },
    weightage: { type: Number, default: 25 }
  }],
  
  isDefault: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('AttainmentTemplate', attainmentTemplateSchema);

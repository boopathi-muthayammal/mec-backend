const mongoose = require('mongoose');

const coMarkSchema = new mongoose.Schema({
  co: { type: String, required: true }, // CO1, CO2, etc.
  marksObtained: { type: Number, required: true, min: 0 },
  maxMarks: { type: Number, required: true, min: 0 }
});

const marksSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  assessmentType: {
    type: String,
    enum: ['CAT1', 'CAT2', 'Model', 'Assignment', 'Lab', 'Seminar'],
    required: true
  },
  coWiseMarks: [coMarkSchema],
  totalObtained: { type: Number },
  totalMax: { type: Number },
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  remarks: { type: String }
}, { timestamps: true });

// Compound index: one record per student per course per assessment
marksSchema.index({ student: 1, course: 1, assessmentType: 1 }, { unique: true });

// Auto-compute totals before save
marksSchema.pre('save', function(next) {
  if (this.coWiseMarks && this.coWiseMarks.length > 0) {
    this.totalObtained = this.coWiseMarks.reduce((sum, m) => sum + m.marksObtained, 0);
    this.totalMax = this.coWiseMarks.reduce((sum, m) => sum + m.maxMarks, 0);
  }
  next();
});

module.exports = mongoose.model('Marks', marksSchema);

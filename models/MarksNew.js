const mongoose = require('mongoose');

// Question-wise marks schema for Unit Tests
const questionMarkSchema = new mongoose.Schema({
  qNo: { type: Number, required: true },    // Q1, Q2, ...
  co: { type: String, required: true },      // CO1, CO2, ...
  maxMarks: { type: Number, required: true },
  marksObtained: { type: Number, required: true, min: 0 }
});

// Unit Test (UNIT 1 - UNIT V): 7 Qs, max 30, one CO each
const unitTestSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  unitNo: { type: Number, required: true, min: 1, max: 5 }, // 1=UNIT1 ... 5=UNIT5
  co: { type: String, required: true },  // CO1...CO5
  questions: [questionMarkSchema],        // Q1-Q7
  totalObtained: { type: Number, default: 0 },
  totalMax: { type: Number, default: 30 },
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
unitTestSchema.index({ student: 1, course: 1, unitNo: 1 }, { unique: true });

// CIA (CIA1 covers CO1+CO2, CIA2 covers CO3+CO4, CIA3/Model covers all COs)
const ciaMarkSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  ciaNo: { type: Number, required: true, enum: [1, 2, 3] }, // CIA1, CIA2, CIA3(Model)
  questions: [questionMarkSchema],
  coWiseMarks: [{
    co: { type: String },
    marksObtained: { type: Number, default: 0 },
    maxMarks: { type: Number, default: 0 }
  }],
  totalObtained: { type: Number, default: 0 },
  totalMax: { type: Number, default: 50 }, // CIA 1&2 = 50, CIA3/Model = 100
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
ciaMarkSchema.index({ student: 1, course: 1, ciaNo: 1 }, { unique: true });

// Viva Voce
const vivaMarkSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  marksObtained: { type: Number, default: 0 },
  maxMarks: { type: Number, default: 100 },
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
vivaMarkSchema.index({ student: 1, course: 1 }, { unique: true });

// Internal Marks (IM) — auto-computed or manual entry
const internalMarkSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  internalMark: { type: Number, default: 0 }, // Consolidated internal /40
  mkc: { type: Number, default: 0, min: 0, max: 10 }, // MKC marks out of 10
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
internalMarkSchema.index({ student: 1, course: 1 }, { unique: true });


// End Semester Exam (University Exam) — CO-wise & Question-wise with Grade
const endSemMarkSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  grade: { type: String, uppercase: true, trim: true },
  questions: [questionMarkSchema],
  coWiseMarks: [{
    co: { type: String },
    marksObtained: { type: Number, default: 0 },
    maxMarks: { type: Number, default: 20 } // default 20 per CO for 100 marks total
  }],
  totalObtained: { type: Number, default: 0 },
  totalMax: { type: Number, default: 100 },
  enteredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });
endSemMarkSchema.index({ student: 1, course: 1 }, { unique: true });

// Indirect Assessment (Course Exit Survey)
const indirectAssessmentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  // Survey ratings 1-3 per CO
  coRatings: [{
    co: { type: String },
    rating: { type: Number, min: 1, max: 3, default: 2 }
  }]
}, { timestamps: true });
indirectAssessmentSchema.index({ student: 1, course: 1 }, { unique: true });

module.exports = {
  UnitTest: mongoose.model('UnitTest', unitTestSchema),
  CIAMark: mongoose.model('CIAMark', ciaMarkSchema),
  VivaMark: mongoose.model('VivaMark', vivaMarkSchema),
  InternalMark: mongoose.model('InternalMark', internalMarkSchema),
  EndSemMark: mongoose.model('EndSemMark', endSemMarkSchema),
  IndirectAssessment: mongoose.model('IndirectAssessment', indirectAssessmentSchema)
};

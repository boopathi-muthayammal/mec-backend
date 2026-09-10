const mongoose = require('mongoose');

const coAttainmentSchema = new mongoose.Schema({
  co: { type: String, required: true },
  directAttainment: { type: Number, default: 0 },   // % students who attained
  indirectAttainment: { type: Number, default: 70 }, // default 70% from survey
  finalAttainment: { type: Number, default: 0 },     // 80% direct + 20% indirect
  attainmentLevel: { type: Number, default: 0 },     // 0, 1, 2, 3
  isAttained: { type: Boolean, default: false }       // >= 60% threshold
});

const poAttainmentSchema = new mongoose.Schema({
  po: { type: String, required: true }, // PO1, PO2, ...
  attainment: { type: Number, default: 0 },
  attainmentLevel: { type: Number, default: 0 }
});

const psoAttainmentSchema = new mongoose.Schema({
  pso: { type: String, required: true },
  attainment: { type: Number, default: 0 },
  attainmentLevel: { type: Number, default: 0 }
});

const attainmentSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, unique: true },
  totalStudents: { type: Number, default: 0 },
  threshold: { type: Number, default: 60 }, // 60% default NBA standard
  coAttainments: [coAttainmentSchema],
  poAttainments: [poAttainmentSchema],
  psoAttainments: [psoAttainmentSchema],
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected'],
    default: 'draft'
  },
  hodRemarks: { type: String },
  calculatedAt: { type: Date },
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('Attainment', attainmentSchema);

const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, // e.g. "2021-2025"
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  regulation: { type: mongoose.Schema.Types.ObjectId, ref: 'AttainmentTemplate' }, // Linked Regulation / Template
  startYear: { type: Number }, // e.g. 2021
  endYear: { type: Number },   // e.g. 2025
  currentSemester: { type: Number, default: 1, min: 1, max: 8 },
  academicYear: { type: String, default: '2024-2025' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

batchSchema.index({ name: 1, department: 1 }, { unique: true });

module.exports = mongoose.model('Batch', batchSchema);

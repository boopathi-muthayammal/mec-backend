const mongoose = require('mongoose');

const mappingEntrySchema = new mongoose.Schema({
  co: { type: String, required: true },  // e.g., "CO1"
  po1: { type: Number, default: 0, min: 0, max: 3 },
  po2: { type: Number, default: 0, min: 0, max: 3 },
  po3: { type: Number, default: 0, min: 0, max: 3 },
  po4: { type: Number, default: 0, min: 0, max: 3 },
  po5: { type: Number, default: 0, min: 0, max: 3 },
  po6: { type: Number, default: 0, min: 0, max: 3 },
  po7: { type: Number, default: 0, min: 0, max: 3 },
  po8: { type: Number, default: 0, min: 0, max: 3 },
  po9: { type: Number, default: 0, min: 0, max: 3 },
  po10: { type: Number, default: 0, min: 0, max: 3 },
  po11: { type: Number, default: 0, min: 0, max: 3 },
  po12: { type: Number, default: 0, min: 0, max: 3 },
  pso1: { type: Number, default: 0, min: 0, max: 3 },
  pso2: { type: Number, default: 0, min: 0, max: 3 }
});

const coMappingSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, unique: true },
  mappings: [mappingEntrySchema],
  // Correlation scale: 1=Low, 2=Medium, 3=High, 0=No correlation
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('COMapping', coMappingSchema);

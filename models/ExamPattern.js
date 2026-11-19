const mongoose = require('mongoose');

const examPatternSchema = new mongoose.Schema({
  examType: {
    type: String,
    required: true,
    unique: true,
    enum: ['unitTest', 'cia1_2', 'cia3']
  },
  name: { type: String, required: true },
  totalMax: { type: Number, required: true },
  questions: [{
    qNo: { type: Number, required: true },
    maxMarks: { type: Number, required: true },
    co: { type: String, default: 'CO1' }
  }],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

module.exports = mongoose.model('ExamPattern', examPatternSchema);

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
const { Admin, Student, Exam, Question, Answer, Result } = require('../database');

const router = express.Router();

// File upload config
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// Admin auth middleware
function adminAuth(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Admin login required.' });
  }
  next();
}
router.use(adminAuth);

// ==================== DASHBOARD ====================
router.get('/dashboard', async (req, res) => {
  try {
    const totalExams = await Exam.countDocuments();
    const totalStudents = await Student.countDocuments();
    const totalResults = await Result.countDocuments();

    const recentResultsRaw = await Result.find()
      .populate('student_id', 'name roll_number')
      .populate('exam_id', 'title')
      .sort({ submitted_at: -1 })
      .limit(10);

    const recentResults = recentResultsRaw.map(r => ({
      id: r._id.toString(),
      student_name: r.student_id ? r.student_id.name : 'Unknown Student',
      roll_number: r.student_id ? r.student_id.roll_number : '—',
      exam_title: r.exam_id ? r.exam_id.title : 'Deleted Exam',
      mcq_score: r.mcq_score,
      mcq_total: r.mcq_total,
      program_submitted: r.program_submitted,
      auto_submitted: r.auto_submitted,
      tab_switches: r.tab_switches,
      submitted_at: r.submitted_at
    }));

    res.json({
      success: true,
      stats: {
        totalExams,
        totalStudents,
        totalResults
      },
      recentResults
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching dashboard data' });
  }
});

// ==================== STUDENTS ====================

// POST /api/admin/students/upload — Upload CSV
router.post('/students/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    
    let records;
    try {
      records = parse(fileContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true
      });
    } catch (parseErr) {
      return res.status(400).json({ success: false, message: 'Invalid CSV format. Please check your file.' });
    }

    if (records.length === 0) {
      return res.status(400).json({ success: false, message: 'CSV file is empty' });
    }

    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      // Support flexible column names
      const rollNumber = (row['Roll Number'] || row['roll_number'] || row['RollNumber'] || row['Roll No'] || row['rollno'] || '').trim().toUpperCase();
      const name = (row['Name'] || row['name'] || row['Student Name'] || '').trim();
      const dob = (row['DOB'] || row['dob'] || row['Date of Birth'] || row['DateOfBirth'] || '').trim();
      const year = parseInt(row['Year'] || row['year'] || '0');
      const section = (row['Section'] || row['section'] || row['Sec'] || '').trim().toUpperCase();

      if (!rollNumber || !name || !dob) {
        errors.push(`Row ${i + 2}: Missing required fields (Roll Number, Name, DOB)`);
        skipped++;
        continue;
      }

      if (!year || year < 1 || year > 4) {
        errors.push(`Row ${i + 2}: Invalid year for ${rollNumber}`);
        skipped++;
        continue;
      }

      // Check duplicate
      const existing = await Student.findOne({ roll_number: rollNumber });
      if (existing) {
        errors.push(`Row ${i + 2}: Roll number ${rollNumber} already exists (skipped)`);
        skipped++;
        continue;
      }

      // Normalize DOB to YYYY-MM-DD
      let normalizedDob = dob;
      if (/^\d{2}[-\/]\d{2}[-\/]\d{4}$/.test(dob)) {
        const parts = dob.split(/[-\/]/);
        normalizedDob = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }

      await Student.create({
        roll_number: rollNumber,
        name,
        dob: normalizedDob,
        year,
        section
      });
      inserted++;
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `${inserted} students uploaded, ${skipped} skipped`,
      inserted,
      skipped,
      errors: errors.slice(0, 20) // limit error messages
    });
  } catch (error) {
    console.error('Student upload error:', error);
    res.status(500).json({ success: false, message: 'Server error uploading students' });
  }
});

// POST /api/admin/students/add — Add single student
router.post('/students/add', async (req, res) => {
  try {
    const { roll_number, name, dob, year, section } = req.body;

    if (!roll_number || !name || !dob || !year || !section) {
      return res.status(400).json({ success: false, message: 'All fields required: roll_number, name, dob, year, section' });
    }

    const existing = await Student.findOne({ roll_number: roll_number.trim().toUpperCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Roll number already exists' });
    }

    // Normalize DOB
    let normalizedDob = dob.trim();
    if (/^\d{2}[-\/]\d{2}[-\/]\d{4}$/.test(normalizedDob)) {
      const parts = normalizedDob.split(/[-\/]/);
      normalizedDob = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    await Student.create({
      roll_number: roll_number.trim().toUpperCase(),
      name: name.trim(),
      dob: normalizedDob,
      year: parseInt(year),
      section: section.trim().toUpperCase()
    });

    res.status(201).json({ success: true, message: 'Student added successfully' });
  } catch (error) {
    console.error('Add student error:', error);
    res.status(500).json({ success: false, message: 'Server error adding student' });
  }
});

// GET /api/admin/students
router.get('/students', async (req, res) => {
  try {
    const { year, section } = req.query;
    const match = {};

    if (year) match.year = parseInt(year);
    if (section) match.section = section.toUpperCase();

    const students = await Student.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'results',
          localField: '_id',
          foreignField: 'student_id',
          as: 'results'
        }
      },
      {
        $project: {
          id: '$_id',
          roll_number: 1,
          name: 1,
          dob: 1,
          year: 1,
          section: 1,
          created_at: 1,
          exams_taken: { $size: '$results' },
          average_score: {
            $let: {
              vars: {
                validResults: {
                  $filter: {
                    input: '$results',
                    as: 'res',
                    cond: { $gt: ['$$res.mcq_total', 0] }
                  }
                }
              },
              in: {
                $cond: {
                  if: { $eq: [{ $size: '$$validResults' }, 0] },
                  then: 0,
                  else: {
                    $round: [
                      {
                        $multiply: [
                          {
                            $avg: {
                              $map: {
                                input: '$$validResults',
                                as: 'r',
                                in: { $divide: ['$$r.mcq_score', '$$r.mcq_total'] }
                              }
                            }
                          },
                          100
                        ]
                      },
                      2
                    ]
                  }
                }
              }
            }
          }
        }
      },
      { $sort: { year: 1, section: 1, roll_number: 1 } }
    ]);

    const formattedStudents = students.map(s => ({
      ...s,
      id: s._id.toString()
    }));

    res.json({ success: true, students: formattedStudents });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching students' });
  }
});

// DELETE /api/admin/students/:id
router.delete('/students/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID' });
    }

    await Answer.deleteMany({ student_id: id });
    await Result.deleteMany({ student_id: id });
    await Student.findByIdAndDelete(id);

    res.json({ success: true, message: 'Student deleted' });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting student' });
  }
});

// ==================== EXAMS ====================
router.post('/exams', async (req, res) => {
  try {
    const { title, description, duration_minutes } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Exam title is required' });
    }
    const duration = parseInt(duration_minutes) || 30;
    const exam = await Exam.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      duration_minutes: duration,
      created_by: req.session.admin.id
    });
    res.status(201).json({ success: true, message: 'Exam created successfully', exam });
  } catch (error) {
    console.error('Create exam error:', error);
    res.status(500).json({ success: false, message: 'Server error creating exam' });
  }
});

router.get('/exams', async (req, res) => {
  try {
    const exams = await Exam.aggregate([
      {
        $lookup: {
          from: 'questions',
          localField: '_id',
          foreignField: 'exam_id',
          as: 'questions'
        }
      },
      {
        $project: {
          id: '$_id',
          title: 1,
          description: 1,
          duration_minutes: 1,
          created_by: 1,
          created_at: 1,
          is_active: 1,
          question_count: { $size: '$questions' }
        }
      },
      { $sort: { created_at: -1 } }
    ]);

    const formattedExams = exams.map(e => ({
      ...e,
      id: e._id.toString()
    }));

    res.json({ success: true, exams: formattedExams });
  } catch (error) {
    console.error('List exams error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching exams' });
  }
});

router.get('/exams/:id', async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    
    const questions = await Question.find({ exam_id: examId }).sort({ _id: 1 });
    res.json({ success: true, exam, questions });
  } catch (error) {
    console.error('Get exam error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching exam' });
  }
});

router.delete('/exams/:id', async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    await Answer.deleteMany({ exam_id: examId });
    await Result.deleteMany({ exam_id: examId });
    await Question.deleteMany({ exam_id: examId });
    await Exam.findByIdAndDelete(examId);

    res.json({ success: true, message: 'Exam deleted successfully' });
  } catch (error) {
    console.error('Delete exam error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting exam' });
  }
});

router.put('/exams/:id/toggle', async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    exam.is_active = !exam.is_active;
    await exam.save();

    res.json({ success: true, message: `Exam ${exam.is_active ? 'activated' : 'deactivated'}`, exam });
  } catch (error) {
    console.error('Toggle exam error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ==================== QUESTIONS ====================

// Add single question (MCQ or PROGRAM)
router.post('/exams/:id/questions', async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const { question_type, question_text, option_a, option_b, option_c, option_d, correct_option, marks } = req.body;
    const type = (question_type || 'MCQ').toUpperCase();

    if (!question_text) {
      return res.status(400).json({ success: false, message: 'Question text is required' });
    }

    if (type === 'MCQ') {
      if (!option_a || !option_b || !option_c || !option_d || !correct_option) {
        return res.status(400).json({ success: false, message: 'MCQ requires all options and correct answer' });
      }
      if (!['A','B','C','D'].includes(correct_option.toUpperCase())) {
        return res.status(400).json({ success: false, message: 'correct_option must be A, B, C, or D' });
      }
    }

    const question = await Question.create({
      exam_id: examId,
      question_type: type,
      question_text: question_text.trim(),
      option_a: type === 'MCQ' ? option_a.trim() : null,
      option_b: type === 'MCQ' ? option_b.trim() : null,
      option_c: type === 'MCQ' ? option_c.trim() : null,
      option_d: type === 'MCQ' ? option_d.trim() : null,
      correct_option: type === 'MCQ' ? correct_option.toUpperCase() : null,
      marks: parseInt(marks) || 1
    });

    res.status(201).json({ success: true, message: 'Question added', question });
  } catch (error) {
    console.error('Add question error:', error);
    res.status(500).json({ success: false, message: 'Server error adding question' });
  }
});

// Upload questions from PDF or Word
router.post('/exams/:id/upload-questions', upload.single('file'), async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let text = '';

    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      text = pdfData.text;
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: req.file.path });
      text = result.value;
    } else if (ext === '.doc') {
      return res.status(400).json({ success: false, message: 'Only .docx files supported for Word. Please save as .docx' });
    } else if (ext === '.txt') {
      text = fs.readFileSync(req.file.path, 'utf-8');
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported file type. Use PDF, DOCX, or TXT' });
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Return extracted text for admin to review
    res.json({
      success: true,
      message: 'Text extracted from file. Review and add questions manually.',
      extracted_text: text.trim()
    });
  } catch (error) {
    console.error('Upload questions error:', error);
    res.status(500).json({ success: false, message: 'Server error processing file' });
  }
});

// Delete question
router.delete('/questions/:id', async (req, res) => {
  try {
    const qId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(qId)) {
      return res.status(400).json({ success: false, message: 'Invalid question ID' });
    }
    const question = await Question.findById(qId);
    if (!question) return res.status(404).json({ success: false, message: 'Question not found' });
    
    await Answer.deleteMany({ question_id: qId });
    await Question.findByIdAndDelete(qId);
    res.json({ success: true, message: 'Question deleted' });
  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting question' });
  }
});

// ==================== RESULTS ====================
router.get('/results', async (req, res) => {
  try {
    const examId = req.query.exam_id;
    const filter = {};
    if (examId && mongoose.Types.ObjectId.isValid(examId)) {
      filter.exam_id = examId;
    }

    const resultsRaw = await Result.find(filter)
      .populate('student_id')
      .populate('exam_id')
      .sort({ submitted_at: -1 });

    const results = resultsRaw.map(r => ({
      id: r._id.toString(),
      student_id: r.student_id ? r.student_id._id.toString() : null,
      student_name: r.student_id ? r.student_id.name : 'Unknown Student',
      roll_number: r.student_id ? r.student_id.roll_number : '—',
      year: r.student_id ? r.student_id.year : null,
      section: r.student_id ? r.student_id.section : '',
      exam_title: r.exam_id ? r.exam_id.title : 'Deleted Exam',
      exam_id: r.exam_id ? r.exam_id._id.toString() : null,
      mcq_score: r.mcq_score,
      mcq_total: r.mcq_total,
      program_submitted: r.program_submitted,
      tab_switches: r.tab_switches,
      auto_submitted: r.auto_submitted,
      submitted_at: r.submitted_at
    }));

    res.json({ success: true, results });
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching results' });
  }
});

// GET /api/admin/exams/:id/answers/:studentId — View student's program answers
router.get('/exams/:id/answers/:studentId', async (req, res) => {
  try {
    const examId = req.params.id;
    const studentId = req.params.studentId;

    if (!mongoose.Types.ObjectId.isValid(examId) || !mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid ID parameters' });
    }

    const student = await Student.findById(studentId, 'name roll_number');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const answersRaw = await Answer.find({ exam_id: examId, student_id: studentId })
      .populate('question_id')
      .sort({ question_id: 1 });

    const answers = answersRaw.map(a => ({
      id: a._id.toString(),
      student_id: a.student_id.toString(),
      exam_id: a.exam_id.toString(),
      question_id: a.question_id ? a.question_id._id.toString() : null,
      answer_text: a.answer_text,
      submitted_at: a.submitted_at,
      question_text: a.question_id ? a.question_id.question_text : 'Deleted Question',
      question_type: a.question_id ? a.question_id.question_type : 'MCQ',
      option_a: a.question_id ? a.question_id.option_a : null,
      option_b: a.question_id ? a.question_id.option_b : null,
      option_c: a.question_id ? a.question_id.option_c : null,
      option_d: a.question_id ? a.question_id.option_d : null,
      correct_option: a.question_id ? a.question_id.correct_option : null,
      marks: a.question_id ? a.question_id.marks : 1
    }));

    res.json({ success: true, student, answers });
  } catch (error) {
    console.error('Get answers error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching answers' });
  }
});

module.exports = router;

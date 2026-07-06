const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
const { Admin, Student, Exam, Question, Answer, Result } = require('../database');
const XLSX = require('xlsx');


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
      student_id: r.student_id ? r.student_id._id.toString() : null,
      exam_id: r.exam_id ? r.exam_id._id.toString() : null,
      student_name: r.student_id ? r.student_id.name : 'Unknown Student',
      roll_number: r.student_id ? r.student_id.roll_number : '—',
      exam_title: r.exam_id ? r.exam_id.title : 'Deleted Exam',
      mcq_score: r.mcq_score,
      mcq_total: r.mcq_total,
      program_score: r.program_score || 0,
      program_total: r.program_total || 0,
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

// Helper function to normalize any date input to YYYY-MM-DD format for <input type="date" /> compatibility
function parseDateToYYYYMMDD(rawDate) {
  if (rawDate === null || rawDate === undefined) return '';
  
  if (rawDate instanceof Date) {
    const year = rawDate.getFullYear();
    const month = String(rawDate.getMonth() + 1).padStart(2, '0');
    const day = String(rawDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  let dob = String(rawDate).trim();
  if (!dob) return '';

  // 1. Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return dob;
  }

  // 2. DD-MM-YYYY or DD/MM/YYYY or DD.MM.YYYY
  const dmyMatch = dob.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // 3. YYYY/MM/DD or YYYY.MM.DD
  const ymdMatch = dob.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 4. DD-MM-YY or DD/MM/YY (2-digit years)
  const dmy2Match = dob.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2})$/);
  if (dmy2Match) {
    const day = dmy2Match[1].padStart(2, '0');
    const month = dmy2Match[2].padStart(2, '0');
    let year = dmy2Match[3];
    year = parseInt(year) <= 30 ? `20${year}` : `19${year}`;
    return `${year}-${month}-${day}`;
  }

  // 5. Try JS Date parser
  const parsed = new Date(dob);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
}

// POST /api/admin/students/parse — Parse file without saving to DB
router.post('/students/parse', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    let records = [];

    if (ext === '.xlsx' || ext === '.xls') {
      try {
        const workbook = XLSX.readFile(req.file.path, { cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        records = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      } catch (excelErr) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'Invalid Excel file.' });
      }
    } else {
      try {
        const fileContent = fs.readFileSync(req.file.path, 'utf-8');
        records = parse(fileContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true
        });
      } catch (parseErr) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: 'Invalid CSV format.' });
      }
    }

    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    const formatted = [];
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const cleanRow = {};
      Object.keys(row).forEach(key => {
        if (key !== null && key !== undefined) {
          const cleanKey = key.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
          cleanRow[cleanKey] = row[key];
        }
      });

      const rollNumber = String(
        cleanRow['registernumber'] || cleanRow['registerno'] ||
        cleanRow['rollnumber'] || cleanRow['rollno'] || ''
      ).trim().toUpperCase();

      const name = String(
        cleanRow['nameofthestudent'] || cleanRow['nameofstudent'] || cleanRow['studentname'] ||
        cleanRow['name'] || ''
      ).trim();
      
      let dobRaw = cleanRow['dateofbirth'] || cleanRow['dob'] || '';
      let dob = '';
      if (typeof dobRaw === 'number') {
        const date = new Date((dobRaw - 25569) * 86400 * 1000);
        if (!isNaN(date.getTime())) {
          dob = parseDateToYYYYMMDD(date);
        }
      } else {
        dob = parseDateToYYYYMMDD(dobRaw);
      }

      // Load row into preview even if some fields are missing (e.g. empty DOB),
      // as long as there is some identifying student info (like roll number or name)
      if (rollNumber || name) {
        formatted.push({ 
          roll_number: rollNumber || '', 
          name: name || '', 
          dob: dob || '' 
        });
      }
    }

    res.json({ success: true, message: `Loaded ${formatted.length} students in memory.`, records: formatted });
  } catch (error) {
    console.error('Parse students error:', error);
    res.status(500).json({ success: false, message: 'Server error parsing students file' });
  }
});

// POST /api/admin/students/save-bulk — Upsert student records from preview roster
router.post('/students/save-bulk', async (req, res) => {
  try {
    const { year, section, students } = req.body;
    const reqYear = parseInt(year || '0');
    const reqSection = (section || '').trim().toUpperCase();

    if (!reqYear || reqYear < 1 || reqYear > 4) {
      return res.status(400).json({ success: false, message: 'Please select a valid Year (1-4)' });
    }
    if (!reqSection) {
      return res.status(400).json({ success: false, message: 'Please select a valid Section' });
    }
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: 'No student records to save.' });
    }

    let saved = 0;
    for (const item of students) {
      const rollNumber = String(item.roll_number || '').trim().toUpperCase();
      const name = String(item.name || '').trim();
      const dob = String(item.dob || '').trim();

      if (rollNumber && name) {
        // Perform Upsert!
        await Student.findOneAndUpdate(
          { roll_number: rollNumber },
          {
            name,
            dob,
            year: reqYear,
            section: reqSection
          },
          { upsert: true, new: true }
         );
         saved++;
      }
    }

    res.json({ success: true, message: `Successfully synchronized and saved ${saved} student records.` });
  } catch (error) {
    console.error('Save bulk students error:', error);
    res.status(500).json({ success: false, message: 'Server error saving students' });
  }
});

// POST /api/admin/students/add — Add single student
router.post('/students/add', async (req, res) => {
  try {
    const { roll_number, name, dob, year, section } = req.body;

    if (!roll_number || !name || !year || !section) {
      return res.status(400).json({ success: false, message: 'Required fields: roll_number, name, year, section' });
    }

    const existing = await Student.findOne({ roll_number: roll_number.trim().toUpperCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Roll number already exists' });
    }

    // Normalize DOB
    let normalizedDob = dob ? String(dob).trim() : '';
    if (normalizedDob && /^\d{2}[-\/]\d{2}[-\/]\d{4}$/.test(normalizedDob)) {
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
    if (section) match.section = section.trim().toUpperCase();

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
    const { title, description, duration_minutes, target_years, target_sections, exam_date } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Exam title is required' });
    }
    if (!target_years || !Array.isArray(target_years) || target_years.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one target Year.' });
    }
    if (!target_sections || !Array.isArray(target_sections) || target_sections.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one target Section.' });
    }

    const duration = parseInt(duration_minutes) || 30;
    const exam = await Exam.create({
      title: title.trim(),
      description: description ? description.trim() : '',
      duration_minutes: duration,
      created_by: req.session.admin.id,
      target_years,
      target_sections: target_sections.map(s => s.trim().toUpperCase()),
      exam_date: exam_date ? new Date(exam_date) : new Date()
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
          exam_date: 1,
          is_active: 1,
          results_released: 1,
          target_years: 1,
          target_sections: 1,
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

router.put('/exams/:id/toggle-results-release', async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    exam.results_released = !exam.results_released;
    await exam.save();

    res.json({ success: true, message: `Exam results ${exam.results_released ? 'released' : 'locked'}`, exam });
  } catch (error) {
    console.error('Toggle exam results release error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST /api/admin/exams/:id/reset — Reset exam results so all students can retake it
router.post('/exams/:id/reset', async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    // Clear all results and answers for this exam
    await Answer.deleteMany({ exam_id: examId });
    await Result.deleteMany({ exam_id: examId });

    res.json({ success: true, message: 'Exam results reset successfully! All students can now retake this exam.' });
  } catch (error) {
    console.error('Reset exam error:', error);
    res.status(500).json({ success: false, message: 'Server error resetting exam' });
  }
});

// PUT /api/admin/exams/:id — Update existing exam details (title, description, duration, date, targets)
router.put('/exams/:id', async (req, res) => {
  try {
    const examId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }
    const { title, description, duration_minutes, exam_date, target_years, target_sections } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Exam title is required' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    exam.title = title.trim();
    exam.description = description ? description.trim() : '';
    exam.duration_minutes = parseInt(duration_minutes) || 30;
    if (exam_date) exam.exam_date = new Date(exam_date);
    if (target_years && Array.isArray(target_years)) exam.target_years = target_years;
    if (target_sections && Array.isArray(target_sections)) {
      exam.target_sections = target_sections.map(s => s.trim().toUpperCase());
    }

    await exam.save();
    res.json({ success: true, message: 'Exam updated successfully', exam });
  } catch (error) {
    console.error('Update exam error:', error);
    res.status(500).json({ success: false, message: 'Server error updating exam' });
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

    const { question_type, question_text, option_a, option_b, option_c, option_d, correct_option, marks, test_cases } = req.body;
    const type = 'MCQ';

    if (!question_text) {
      return res.status(400).json({ success: false, message: 'Question text is required' });
    }

    if (!option_a || !option_b || !option_c || !option_d || !correct_option) {
      return res.status(400).json({ success: false, message: 'MCQ requires all options and correct answer' });
    }
    if (!['A','B','C','D'].includes(correct_option.toUpperCase())) {
      return res.status(400).json({ success: false, message: 'correct_option must be A, B, C, or D' });
    }

    const question = await Question.create({
      exam_id: examId,
      question_type: type,
      question_text: question_text.trim(),
      option_a: option_a.trim(),
      option_b: option_b.trim(),
      option_c: option_c.trim(),
      option_d: option_d.trim(),
      correct_option: correct_option.toUpperCase(),
      marks: parseInt(marks) || 1
    });

    res.status(201).json({ success: true, message: 'Question added', question });
  } catch (error) {
    console.error('Add question error:', error);
    res.status(500).json({ success: false, message: 'Server error adding question' });
  }
});

// Helper to scan text and parse MCQ questions, options, and correct answers
function parseQuestionsFromText(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
  const parsedQuestions = [];
  let currentQuestion = null;

  const isValidQuestion = (q) => {
    return q && q.question_text && q.option_a; // Require at least question text and option A
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Check if line starts a question (e.g. "1. What is..." or "Q1. What is..." or "Question 5: What is...")
    const qMatch = line.match(/^(?:Question|Q|q)?\s*[\-\s]*(\d+)[\.\):\s]\s*(.*)$/i);
    if (qMatch) {
      if (isValidQuestion(currentQuestion)) {
        if (!currentQuestion.correct_option) currentQuestion.correct_option = 'A';
        parsedQuestions.push(currentQuestion);
      }
      currentQuestion = {
        question_text: qMatch[2].trim(),
        option_a: '',
        option_b: '',
        option_c: '',
        option_d: '',
        correct_option: '',
        question_type: 'MCQ',
        marks: 1
      };
      continue;
    }

    if (!currentQuestion) continue;

    // Check if inline options (e.g. a) option1 b) option2 c) option3 d) option4)
    const inlineOptMatch = line.match(/^(?:\(|\[)?\s*[aA]\s*(?:\)|\.|\]|\s)\s*(.*?)\s*(?:\(|\[)?\s*[bB]\s*(?:\)|\.|\]|\s)\s*(.*?)\s*(?:\(|\[)?\s*[cC]\s*(?:\)|\.|\]|\s)\s*(.*?)\s*(?:\(|\[)?\s*[dD]\s*(?:\)|\.|\]|\s)\s*(.*)$/);
    if (inlineOptMatch) {
      currentQuestion.option_a = inlineOptMatch[1].trim();
      currentQuestion.option_b = inlineOptMatch[2].trim();
      currentQuestion.option_c = inlineOptMatch[3].trim();
      currentQuestion.option_d = inlineOptMatch[4].trim();
      continue;
    }

    // Check individual options
    const optAMatch = line.match(/^(?:\(|\[)?\s*[aA]\s*(?:\)|\.|\]|\s)\s*(.*)$/);
    if (optAMatch) {
      currentQuestion.option_a = optAMatch[1].trim();
      continue;
    }
    const optBMatch = line.match(/^(?:\(|\[)?\s*[bB]\s*(?:\)|\.|\]|\s)\s*(.*)$/);
    if (optBMatch) {
      currentQuestion.option_b = optBMatch[1].trim();
      continue;
    }
    const optCMatch = line.match(/^(?:\(|\[)?\s*[cC]\s*(?:\)|\.|\]|\s)\s*(.*)$/);
    if (optCMatch) {
      currentQuestion.option_c = optCMatch[1].trim();
      continue;
    }
    const optDMatch = line.match(/^(?:\(|\[)?\s*[dD]\s*(?:\)|\.|\]|\s)\s*(.*)$/);
    if (optDMatch) {
      currentQuestion.option_d = optDMatch[1].trim();
      continue;
    }

    // Check answer line (e.g. "Answer: A" or "Ans - B" or "Correct Option: C" or "Answer is A")
    const ansMatch = line.match(/^(?:Answer|Ans|Correct|Correct Option|Correct Answer|Ans is|Answer is)\s*[\-\[\]\(\):\s]*([a-dE-eA-D])/i);
    if (ansMatch) {
      currentQuestion.correct_option = ansMatch[1].toUpperCase().trim();
      continue;
    }

    // If it's a multi-line question text, append to question_text
    if (!currentQuestion.option_a && !currentQuestion.option_b && !currentQuestion.option_c && !currentQuestion.option_d && !currentQuestion.correct_option) {
      currentQuestion.question_text += '\n' + line;
    }
  }

  // Push final question if valid
  if (isValidQuestion(currentQuestion)) {
    if (!currentQuestion.correct_option) currentQuestion.correct_option = 'A';
    parsedQuestions.push(currentQuestion);
  }

  return parsedQuestions;
}

// Upload questions from PDF or Word & insert directly to DB
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
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Only .docx files supported for Word. Please save as .docx' });
    } else if (ext === '.txt') {
      text = fs.readFileSync(req.file.path, 'utf-8');
    } else {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Unsupported file type. Use PDF, DOCX, or TXT' });
    }

    // Clean up uploaded file
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    // Debug: Dump raw text to help inspect the user's PDF formatting
    try {
      fs.writeFileSync(path.join(__dirname, '../uploads/last_uploaded_text.txt'), text);
    } catch (e) {
      console.error('Error writing debug file:', e);
    }

    // Parse questions from extracted text
    const parsedQuestions = parseQuestionsFromText(text);

    if (parsedQuestions.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Could not parse any valid questions. Please verify file format (e.g. "1. Question text\\n a) option A\\n b) option B\\n c) option C\\n d) option D\\n Answer: A")' 
      });
    }

    // Insert questions to DB
    const insertedQuestions = [];
    for (const q of parsedQuestions) {
      const question = await Question.create({
        exam_id: examId,
        question_type: 'MCQ',
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        correct_option: q.correct_option,
        marks: q.marks || 1
      });
      insertedQuestions.push(question);
    }

    res.json({
      success: true,
      message: `Successfully parsed and imported ${insertedQuestions.length} questions directly into the exam!`,
      count: insertedQuestions.length
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
      program_score: r.program_score || 0,
      program_total: r.program_total || 0,
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

// GET /api/admin/results/class-report — Detailed report of a class for an exam
router.get('/results/class-report', async (req, res) => {
  try {
    const { exam_id, year, section } = req.query;
    if (!exam_id || !year || !section) {
      return res.status(400).json({ success: false, message: 'exam_id, year, and section are required parameters.' });
    }

    if (!mongoose.Types.ObjectId.isValid(exam_id)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID.' });
    }

    const exam = await Exam.findById(exam_id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Exam not found' });
    }

    // Find all students registered in this year and section
    const students = await Student.find({
      year: parseInt(year),
      section: section.trim().toUpperCase()
    }).sort({ roll_number: 1 });

    // Find all results for this exam
    const results = await Result.find({ exam_id });
    
    // Create de-duplicated map of results (keys are student_id string)
    const resultMap = new Map();
    results.forEach(r => {
      if (r.student_id) {
        resultMap.set(r.student_id.toString(), r);
      }
    });
    
    // Filter results to only include students in this year/section
    const studentIdsInClass = new Set(students.map(s => s._id.toString()));

    // Get de-duplicated results for this class and sort by score descending
    const deDuplicatedClassResults = Array.from(resultMap.values())
      .filter(r => r.student_id && studentIdsInClass.has(r.student_id.toString()))
      .map(r => ({
        student_id: r.student_id.toString(),
        total_score: r.mcq_score || 0
      }))
      .sort((a, b) => b.total_score - a.total_score);

    // Assign competition ranks
    const ranks = new Map();
    let currentRank = 1;
    for (let i = 0; i < deDuplicatedClassResults.length; i++) {
      if (i > 0 && deDuplicatedClassResults[i].total_score < deDuplicatedClassResults[i - 1].total_score) {
        currentRank = i + 1;
      }
      ranks.set(deDuplicatedClassResults[i].student_id, currentRank);
    }

    const report = students.map(student => {
      const studentIdStr = student._id.toString();
      const hasResult = resultMap.has(studentIdStr);
      const result = resultMap.get(studentIdStr);
      const rank = hasResult ? ranks.get(studentIdStr) : null;

      return {
        student_id: studentIdStr,
        roll_number: student.roll_number,
        name: student.name,
        attended: hasResult,
        rank: rank,
        score_details: hasResult ? {
          mcq_score: result.mcq_score,
          mcq_total: result.mcq_total,
          total_score: result.mcq_score || 0,
          total_possible: result.mcq_total || 0
        } : null,
        tab_switches: hasResult ? result.tab_switches : 0,
        auto_submitted: hasResult ? result.auto_submitted : false,
        submitted_at: hasResult ? result.submitted_at : null
      };
    });

    res.json({
      success: true,
      exam_title: exam.title,
      report
    });
  } catch (error) {
    console.error('Class report error:', error);
    res.status(500).json({ success: false, message: 'Server error generating class report' });
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
      language: a.language || null,
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

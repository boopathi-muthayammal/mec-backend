const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { Exam, Question, Result, Answer } = require('../database');

const router = express.Router();

// Ensure MSYS2/MinGW PATH is loaded programmatically on Windows for code execution
if (process.platform === 'win32') {
  const extraPath = 'C:\\msys64\\ucrt64\\bin';
  if (!process.env.PATH.includes(extraPath)) {
    process.env.PATH = `${process.env.PATH};${extraPath}`;
  }
}

function studentAuth(req, res, next) {
  if (!req.session.student) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Student login required.' });
  }
  next();
}
router.use(studentAuth);

// GET /api/student/exams — List active exams
router.get('/exams', async (req, res) => {
  try {
    const studentId = req.session.student.id;
    const studentYear = parseInt(req.session.student.year || '0');
    const studentSection = (req.session.student.section || '').trim().toUpperCase();

    const exams = await Exam.aggregate([
      { 
        $match: { 
          is_active: true,
          $and: [
            { $or: [ { target_years: studentYear }, { target_years: { $exists: false } } ] },
            { $or: [ { target_sections: studentSection }, { target_sections: { $exists: false } } ] }
          ]
        } 
      },
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
          created_at: 1,
          question_count: { $size: '$questions' }
        }
      },
      { $sort: { created_at: -1 } }
    ]);

    const takenExams = await Result.find({ student_id: studentId }, 'exam_id');
    const takenExamIds = new Set(takenExams.map(r => r.exam_id.toString()));

    const examsWithStatus = exams.map(exam => ({
      ...exam,
      id: exam._id.toString(),
      already_taken: takenExamIds.has(exam._id.toString())
    }));

    res.json({ success: true, exams: examsWithStatus });
  } catch (error) {
    console.error('Student list exams error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching exams' });
  }
});

// Seeded shuffle helper to randomize questions deterministically per student
function seededShuffle(array, seedString) {
  let seed = 0;
  for (let i = 0; i < seedString.length; i++) {
    seed = (seed * 31 + seedString.charCodeAt(i)) & 0xffffffff;
  }
  function random() {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// GET /api/student/exams/:id/start — Start exam (get questions without answers)
router.get('/exams/:id/start', async (req, res) => {
  try {
    const examId = req.params.id;
    const studentId = req.session.student.id;
    const studentYear = parseInt(req.session.student.year || '0');
    const studentSection = (req.session.student.section || '').trim().toUpperCase();

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    if (!exam.is_active) return res.status(403).json({ success: false, message: 'This exam is not currently active' });

    // Target filtering checks
    if (exam.target_years && exam.target_years.length > 0 && !exam.target_years.includes(studentYear)) {
      return res.status(403).json({ success: false, message: 'This exam is not assigned to your Year.' });
    }
    if (exam.target_sections && exam.target_sections.length > 0 && !exam.target_sections.map(s => s.toUpperCase()).includes(studentSection)) {
      return res.status(403).json({ success: false, message: 'This exam is not assigned to your Section.' });
    }

    const existingResult = await Result.findOne({ student_id: studentId, exam_id: examId });
    if (existingResult) return res.status(403).json({ success: false, message: 'You have already taken this exam' });

    // Get questions WITHOUT correct_option (for MCQ) and with safe test_cases (for PROGRAM)
    const questionsRaw = await Question.find(
      { exam_id: examId },
      'id exam_id question_type question_text option_a option_b option_c option_d marks test_cases'
    ).sort({ _id: 1 });

    if (questionsRaw.length === 0) {
      return res.status(400).json({ success: false, message: 'This exam has no questions yet' });
    }

    const questions = questionsRaw.map(q => ({
      id: q._id.toString(),
      exam_id: q.exam_id.toString(),
      question_type: q.question_type,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      marks: q.marks,
      test_cases: q.test_cases ? q.test_cases.map(tc => {
        if (tc.is_public) {
          return {
            id: tc._id.toString(),
            input: tc.input,
            expected_output: tc.expected_output,
            is_public: true
          };
        }
        return {
          id: tc._id.toString(),
          is_public: false
        };
      }) : []
    }));

    // Deterministically shuffle questions unique to each student
    const shuffledQuestions = seededShuffle(questions, studentId.toString() + examId.toString());

    res.json({
      success: true,
      exam: {
        id: exam._id.toString(),
        title: exam.title,
        description: exam.description,
        duration_minutes: exam.duration_minutes
      },
      questions: shuffledQuestions
    });
  } catch (error) {
    console.error('Start exam error:', error);
    res.status(500).json({ success: false, message: 'Server error starting exam' });
  }
});

// POST /api/student/exams/:id/submit — Submit exam
router.post('/exams/:id/submit', async (req, res) => {
  try {
    const examId = req.params.id;
    const studentId = req.session.student.id;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    const existingResult = await Result.findOne({ student_id: studentId, exam_id: examId });
    if (existingResult) return res.status(403).json({ success: false, message: 'You have already submitted this exam' });

    const { answers, languages, tab_switches, auto_submitted } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ success: false, message: 'Answers object is required' });
    }

    // Get all questions with correct answers
    const questions = await Question.find({ exam_id: examId });

    let mcqScore = 0;
    let mcqTotal = 0;
    let programScore = 0;
    let programTotal = 0;
    let programSubmitted = false;

    // Save each answer and calculate scores
    for (const question of questions) {
      const qIdStr = question._id.toString();
      const studentAnswer = answers[qIdStr] || answers[question._id] || '';
      const studentLang = (languages && (languages[qIdStr] || languages[question._id])) || null;

      if (question.question_type === 'MCQ') {
        mcqTotal += (question.marks || 1);
        if (studentAnswer && studentAnswer.toUpperCase() === question.correct_option) {
          mcqScore += (question.marks || 1);
        }
      } else if (question.question_type === 'PROGRAM') {
        programTotal += (question.marks || 1);
        if (studentAnswer && studentAnswer.trim().length > 0) {
          programSubmitted = true;
          
          let passedCases = 0;
          const totalCases = question.test_cases ? question.test_cases.length : 0;
          
          if (totalCases > 0) {
            for (const tc of question.test_cases) {
              try {
                const execResult = await runCodeAgainstTestCase(studentAnswer, studentLang || 'javascript', tc.input);
                if (execResult.status === 'success') {
                  const normalizedActual = (execResult.stdout || '').replace(/\r\n/g, '\n').trim();
                  const normalizedExpected = (tc.expected_output || '').replace(/\r\n/g, '\n').trim();
                  if (normalizedActual === normalizedExpected) {
                    passedCases++;
                  }
                }
              } catch (tcErr) {
                console.error(`Error running test case for question ${qIdStr}:`, tcErr);
              }
            }
            // Proportional marks calculation
            programScore += (passedCases / totalCases) * (question.marks || 1);
          }
        }
      }

      // Save answer to answers table
      if (studentAnswer) {
        await Answer.create({
          student_id: studentId,
          exam_id: examId,
          question_id: question._id,
          answer_text: typeof studentAnswer === 'string' ? studentAnswer : studentAnswer.toString(),
          language: studentLang
        });
      }
    }

    const finalProgramScore = Math.round(programScore * 100) / 100;

    // Insert result
    await Result.create({
      student_id: studentId,
      exam_id: examId,
      mcq_score: mcqScore,
      mcq_total: mcqTotal,
      program_score: finalProgramScore,
      program_total: programTotal,
      program_submitted: programSubmitted,
      tab_switches: parseInt(tab_switches) || 0,
      auto_submitted: !!auto_submitted
    });

    res.json({
      success: true,
      message: 'Exam submitted successfully',
      evaluation: {
        mcq_score: mcqScore,
        mcq_total: mcqTotal,
        program_score: finalProgramScore,
        program_total: programTotal,
        tab_switches: parseInt(tab_switches) || 0
      }
    });
  } catch (error) {
    console.error('Submit exam error:', error);
    res.status(500).json({ success: false, message: 'Server error submitting exam' });
  }
});

// GET /api/student/results — Only show submitted/not-attempted status (NO scores)
router.get('/results', async (req, res) => {
  try {
    const studentId = req.session.student.id;

    const resultsRaw = await Result.find({ student_id: studentId })
      .populate('exam_id', 'title')
      .sort({ submitted_at: -1 });

    const results = resultsRaw.map(r => ({
      id: r._id.toString(),
      exam_id: r.exam_id ? r.exam_id._id.toString() : null,
      exam_title: r.exam_id ? r.exam_id.title : 'Deleted Exam',
      submitted_at: r.submitted_at
    }));

    res.json({ success: true, results });
  } catch (error) {
    console.error('Student results error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching results' });
  }
});

// Helper function to run student code against a single testcase
function runCodeAgainstTestCase(code, language, input, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const filename = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    let filePath, cmd, args, buildCmd = null;

    if (language === 'javascript' || language === 'nodejs') {
      filePath = path.join(uploadsDir, `${filename}.js`);
      fs.writeFileSync(filePath, code);
      cmd = 'node';
      args = [filePath];
    } else if (language === 'python') {
      filePath = path.join(uploadsDir, `${filename}.py`);
      fs.writeFileSync(filePath, code);
      cmd = 'python';
      args = [filePath];
    } else if (language === 'c') {
      filePath = path.join(uploadsDir, `${filename}.c`);
      const execPath = path.join(uploadsDir, filename + (process.platform === 'win32' ? '.exe' : ''));
      fs.writeFileSync(filePath, code);
      buildCmd = `gcc "${filePath}" -o "${execPath}"`;
      cmd = execPath;
      args = [];
    } else {
      return resolve({ status: 'error', error_message: 'Unsupported language selection.' });
    }

    const cleanUp = () => {
      try {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (language === 'c') {
          const execPath = path.join(uploadsDir, filename + (process.platform === 'win32' ? '.exe' : ''));
          if (fs.existsSync(execPath)) fs.unlinkSync(execPath);
        }
      } catch (e) {}
    };

    if (buildCmd) {
      exec(buildCmd, { timeout: 8000 }, (compileError, stdout, stderr) => {
        if (compileError) {
          cleanUp();
          return resolve({
            status: 'error',
            error_message: `Compilation Error:\n${stderr || compileError.message}`
          });
        }
        runProcess();
      });
    } else {
      runProcess();
    }

    function runProcess() {
      const child = spawn(cmd, args, { timeout: timeoutMs });
      let output = '';
      let errOutput = '';
      let isTimeout = false;

      const timer = setTimeout(() => {
        isTimeout = true;
        child.kill();
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        errOutput += data.toString();
      });

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        cleanUp();

        if (isTimeout) {
          return resolve({ status: 'timeout', error_message: 'Time Limit Exceeded (3s)' });
        }

        if (exitCode !== 0 && errOutput) {
          return resolve({ status: 'error', error_message: `Runtime Error:\n${errOutput}` });
        }

        resolve({ status: 'success', stdout: output });
      });

      if (input) {
        child.stdin.write(input);
      }
      child.stdin.end();
    }
  });
}

// POST /api/student/run-code — Run code against test cases
router.post('/run-code', async (req, res) => {
  try {
    const { questionId, code, language } = req.body;

    if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(400).json({ success: false, message: 'Invalid question ID' });
    }
    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, message: 'Code cannot be empty' });
    }
    if (!['javascript', 'python', 'c'].includes(language)) {
      return res.status(400).json({ success: false, message: 'Invalid or unsupported language selection.' });
    }

    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }
    if (question.question_type !== 'PROGRAM') {
      return res.status(400).json({ success: false, message: 'Question is not a programming question' });
    }

    const results = [];

    // Run code sequentially against each test case
    for (const tc of question.test_cases) {
      const execResult = await runCodeAgainstTestCase(code, language, tc.input);

      let status = 'fail';
      let error_message = execResult.error_message || '';
      const actual_output = execResult.stdout || '';

      if (execResult.status === 'success') {
        // Normalize newlines and trim whitespace for robust comparison
        const normalizedActual = actual_output.replace(/\r\n/g, '\n').trim();
        const normalizedExpected = tc.expected_output.replace(/\r\n/g, '\n').trim();
        if (normalizedActual === normalizedExpected) {
          status = 'pass';
        }
      } else if (execResult.status === 'timeout') {
        status = 'timeout';
      } else {
        status = 'error';
      }

      // Format test case result response
      if (tc.is_public) {
        results.push({
          id: tc._id.toString(),
          input: tc.input,
          expected_output: tc.expected_output,
          actual_output,
          status,
          is_public: true,
          error_message
        });
      } else {
        results.push({
          id: tc._id.toString(),
          status,
          is_public: false,
          error_message: status === 'error' || status === 'timeout' ? error_message : ''
        });
      }
    }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Run code endpoint error:', error);
    res.status(500).json({ success: false, message: 'Server error during code execution' });
  }
});

// POST /api/student/run-custom-code — Run code against custom user-provided input
router.post('/run-custom-code', async (req, res) => {
  try {
    const { code, language, customInput } = req.body;

    if (!code || !code.trim()) {
      return res.status(400).json({ success: false, message: 'Code cannot be empty' });
    }
    if (!['javascript', 'python', 'c'].includes(language)) {
      return res.status(400).json({ success: false, message: 'Invalid or unsupported language selection.' });
    }

    const execResult = await runCodeAgainstTestCase(code, language, customInput || '');

    res.json({
      success: true,
      status: execResult.status,
      stdout: execResult.stdout || '',
      error_message: execResult.error_message || ''
    });
  } catch (error) {
    console.error('Run custom code endpoint error:', error);
    res.status(500).json({ success: false, message: 'Server error during custom code execution' });
  }
});

module.exports = router;

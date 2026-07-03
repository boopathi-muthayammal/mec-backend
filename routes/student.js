const express = require('express');
const mongoose = require('mongoose');
const { Exam, Question, Result, Answer } = require('../database');

const router = express.Router();

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

    const exams = await Exam.aggregate([
      { $match: { is_active: true } },
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

// GET /api/student/exams/:id/start — Start exam (get questions without answers)
router.get('/exams/:id/start', async (req, res) => {
  try {
    const examId = req.params.id;
    const studentId = req.session.student.id;

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid exam ID' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    if (!exam.is_active) return res.status(403).json({ success: false, message: 'This exam is not currently active' });

    const existingResult = await Result.findOne({ student_id: studentId, exam_id: examId });
    if (existingResult) return res.status(403).json({ success: false, message: 'You have already taken this exam' });

    // Get questions WITHOUT correct_option
    const questionsRaw = await Question.find(
      { exam_id: examId },
      'id exam_id question_type question_text option_a option_b option_c option_d marks'
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
      marks: q.marks
    }));

    res.json({
      success: true,
      exam: {
        id: exam._id.toString(),
        title: exam.title,
        description: exam.description,
        duration_minutes: exam.duration_minutes
      },
      questions
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

    const { answers, tab_switches, auto_submitted } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ success: false, message: 'Answers object is required' });
    }

    // Get all questions with correct answers
    const questions = await Question.find({ exam_id: examId });

    let mcqScore = 0;
    let mcqTotal = 0;
    let programSubmitted = false;

    // Save each answer and calculate MCQ score
    for (const question of questions) {
      const qIdStr = question._id.toString();
      const studentAnswer = answers[qIdStr] || answers[question._id] || '';

      if (question.question_type === 'MCQ') {
        mcqTotal += (question.marks || 1);
        if (studentAnswer && studentAnswer.toUpperCase() === question.correct_option) {
          mcqScore += (question.marks || 1);
        }
      } else if (question.question_type === 'PROGRAM') {
        if (studentAnswer && studentAnswer.trim().length > 0) {
          programSubmitted = true;
        }
      }

      // Save answer to answers table
      if (studentAnswer) {
        await Answer.create({
          student_id: studentId,
          exam_id: examId,
          question_id: question._id,
          answer_text: typeof studentAnswer === 'string' ? studentAnswer : studentAnswer.toString()
        });
      }
    }

    // Insert result
    await Result.create({
      student_id: studentId,
      exam_id: examId,
      mcq_score: mcqScore,
      mcq_total: mcqTotal,
      program_submitted: programSubmitted,
      tab_switches: parseInt(tab_switches) || 0,
      auto_submitted: !!auto_submitted
    });

    res.json({
      success: true,
      message: 'Exam submitted successfully'
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

module.exports = router;

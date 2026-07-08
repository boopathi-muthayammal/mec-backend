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
          question_count: { $size: '$questions' },
          question_ids: '$questions._id'
        }
      },
      { $sort: { created_at: -1 } }
    ]);

    const takenExams = await Result.find({ student_id: studentId }, 'exam_id submitted_at');
    const takenExamsMap = new Map(takenExams.map(r => [r.exam_id.toString(), r.submitted_at]));

    const examsWithStatus = exams.map(exam => {
      const eid = exam._id.toString();
      const alreadyTaken = takenExamsMap.has(eid);
      let newQuestionCount = 0;
      if (alreadyTaken && exam.question_ids) {
        const submissionTime = takenExamsMap.get(eid);
        // A question is considered "newly added" if its creation timestamp (from its ObjectId)
        // is strictly greater than the student's exam submission time.
        newQuestionCount = exam.question_ids.filter(qid => {
          try {
            let oid = qid;
            if (typeof qid === 'string') {
              oid = new mongoose.Types.ObjectId(qid);
            } else if (qid && typeof qid === 'object' && !qid.getTimestamp && qid.toString) {
              oid = new mongoose.Types.ObjectId(qid.toString());
            }
            if (oid && typeof oid.getTimestamp === 'function') {
              const qTimestamp = oid.getTimestamp();
              return qTimestamp > submissionTime;
            }
          } catch (e) {
            console.error('Error getting timestamp for qid:', qid, e);
          }
          return false;
        }).length;
      }
      return {
        ...exam,
        id: eid,
        already_taken: alreadyTaken,
        new_question_count: newQuestionCount
      };
    });

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

    // Get all questions (without correct answers)
    const questionsRaw = await Question.find(
      { exam_id: examId },
      'id exam_id question_type question_text option_a option_b option_c option_d marks test_cases'
    ).sort({ _id: 1 });

    if (questionsRaw.length === 0) {
      return res.status(400).json({ success: false, message: 'This exam has no questions yet' });
    }

    const mapQuestion = q => ({
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
          return { id: tc._id.toString(), input: tc.input, expected_output: tc.expected_output, is_public: true };
        }
        return { id: tc._id.toString(), is_public: false };
      }) : []
    });

    // --- PARTIAL RETAKE: student already submitted but admin added new questions ---
    if (existingResult) {
      const submissionTime = existingResult.submitted_at;
      // Filter questions to only those created after the student's submission time
      const newQuestionsRaw = questionsRaw.filter(q => {
        try {
          let oid = q._id;
          if (typeof oid === 'string') {
            oid = new mongoose.Types.ObjectId(oid);
          }
          if (oid && typeof oid.getTimestamp === 'function') {
            const qTimestamp = oid.getTimestamp();
            return qTimestamp > submissionTime;
          }
        } catch (e) {
          console.error('Error getting timestamp for question _id:', q._id, e);
        }
        return false;
      });

      if (newQuestionsRaw.length === 0) {
        return res.status(403).json({ success: false, message: 'You have already completed this exam and there are no new questions.' });
      }

      const unansweredQuestions = newQuestionsRaw.map(mapQuestion);
      // No shuffle for partial retake — show new questions in order
      return res.json({
        success: true,
        partial_retake: true,
        new_question_count: unansweredQuestions.length,
        exam: {
          id: exam._id.toString(),
          title: exam.title,
          description: exam.description,
          duration_minutes: Math.max(5, Math.round(exam.duration_minutes * unansweredQuestions.length / questionsRaw.length))
        },
        questions: unansweredQuestions
      });
    }

    // --- NORMAL FIRST ATTEMPT ---
    const questions = questionsRaw.map(mapQuestion);
    // Deterministically shuffle questions unique to each student
    const shuffledQuestions = seededShuffle(questions, studentId.toString() + examId.toString());

    res.json({
      success: true,
      partial_retake: false,
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

    const { answers, tab_switches, auto_submitted } = req.body;

    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ success: false, message: 'Answers object is required' });
    }

    // Get all questions with correct answers
    const questions = await Question.find({ exam_id: examId });

    // --- PARTIAL RETAKE: student already has a result, update it with new answers ---
    if (existingResult) {
      // Only accept answers for questions not already answered
      const alreadyAnswered = await Answer.find({ student_id: studentId, exam_id: examId }, 'question_id');
      const answeredQIds = new Set(alreadyAnswered.map(a => a.question_id.toString()));

      let additionalScore = 0;
      const newAnswersToInsert = [];

      for (const question of questions) {
        const qIdStr = question._id.toString();
        if (answeredQIds.has(qIdStr)) continue; // skip already answered questions

        const studentAnswer = answers[qIdStr] || '';

        // Calculate score only if answer was provided and is correct
        if (studentAnswer && question.question_type === 'MCQ' && studentAnswer.toUpperCase() === question.correct_option) {
          additionalScore += (question.marks || 1);
        }

        // ALWAYS insert an Answer record for every new question — even if unanswered (answer_text='').
        // This marks the question as "attempted" so new_question_count becomes 0 on the dashboard.
        // Without this, auto-submitted students (who answered 0 questions) kept seeing "Answer New Questions"
        // because the Answer table had no records for these questions.
        newAnswersToInsert.push({
          student_id: studentId,
          exam_id: examId,
          question_id: question._id,
          answer_text: typeof studentAnswer === 'string' ? studentAnswer : (studentAnswer ? studentAnswer.toString() : '')
        });
      }

      if (newAnswersToInsert.length > 0) {
        await Answer.insertMany(newAnswersToInsert);
      }

      // Update the existing result with new score
      const newMcqTotal = questions.filter(q => q.question_type === 'MCQ').reduce((sum, q) => sum + (q.marks || 1), 0);
      await Result.findByIdAndUpdate(existingResult._id, {
        mcq_score: existingResult.mcq_score + additionalScore,
        mcq_total: newMcqTotal,
        submitted_at: new Date()
      });

      return res.json({
        success: true,
        message: 'New answers submitted successfully',
        partial_retake: true,
        evaluation: {
          mcq_score: existingResult.mcq_score + additionalScore,
          mcq_total: newMcqTotal,
          tab_switches: existingResult.tab_switches
        }
      });
    }

    // --- NORMAL FIRST SUBMISSION ---
    let mcqScore = 0;
    let mcqTotal = 0;

    const answersToInsert = [];

    // Save each answer and calculate scores
    for (const question of questions) {
      const qIdStr = question._id.toString();
      const studentAnswer = answers[qIdStr] || answers[question._id] || '';

      if (question.question_type === 'MCQ') {
        mcqTotal += (question.marks || 1);
        if (studentAnswer && studentAnswer.toUpperCase() === question.correct_option) {
          mcqScore += (question.marks || 1);
        }
      }

      // Buffer answer for batch insertion
      if (studentAnswer) {
        answersToInsert.push({
          student_id: studentId,
          exam_id: examId,
          question_id: question._id,
          answer_text: typeof studentAnswer === 'string' ? studentAnswer : studentAnswer.toString()
        });
      }
    }

    if (answersToInsert.length > 0) {
      await Answer.insertMany(answersToInsert);
    }

    // Use upsert to prevent duplicate results if request is retried
    await Result.findOneAndUpdate(
      { student_id: studentId, exam_id: examId },
      {
        $setOnInsert: {
          student_id: studentId,
          exam_id: examId,
          tab_switches: parseInt(tab_switches) || 0,
          auto_submitted: !!auto_submitted
        },
        $set: {
          mcq_score: mcqScore,
          mcq_total: mcqTotal,
          submitted_at: new Date()
        }
      },
      { upsert: true, new: true }
    );

    // Clear the active session for live tracking
    await Student.findByIdAndUpdate(studentId, {
      active_exam_id: null,
      last_ping: null
    });

    res.json({
      success: true,
      message: 'Exam submitted successfully',
      evaluation: {
        mcq_score: mcqScore,
        mcq_total: mcqTotal,
        tab_switches: parseInt(tab_switches) || 0
      }
    });
  } catch (error) {
    console.error('Submit exam error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error submitting exam' });
  }
});


// GET /api/student/results — Only show individual exam marks if released by admin
router.get('/results', async (req, res) => {
  try {
    const studentId = req.session.student.id;

    const resultsRaw = await Result.find({ student_id: studentId })
      .populate('exam_id', 'title results_released')
      .sort({ submitted_at: -1 });

    const results = resultsRaw.map(r => {
      const released = r.exam_id ? r.exam_id.results_released : false;
      return {
        id: r._id.toString(),
        exam_id: r.exam_id ? r.exam_id._id.toString() : null,
        exam_title: r.exam_id ? r.exam_id.title : 'Deleted Exam',
        released: released,
        mcq_score: released ? r.mcq_score : null,
        mcq_total: released ? r.mcq_total : null,
        submitted_at: r.submitted_at
      };
    });

    // Deduplicate: keep only the latest result per exam (in case of legacy duplicates in DB)
    const seen = new Set();
    const deduplicated = results.filter(r => {
      if (seen.has(r.exam_id)) return false;
      seen.add(r.exam_id);
      return true;
    });

    res.json({ success: true, results: deduplicated });
  } catch (error) {
    console.error('Student results error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching results' });
  }
});

// GET /api/student/results/:resultId/detailed — Fetch detailed answers if results are released
router.get('/results/:resultId/detailed', async (req, res) => {
  try {
    const studentId = req.session.student.id;
    const resultId = req.params.resultId;

    if (!mongoose.Types.ObjectId.isValid(resultId)) {
      return res.status(400).json({ success: false, message: 'Invalid result ID' });
    }

    const result = await Result.findOne({ _id: resultId, student_id: studentId })
      .populate('exam_id', 'title results_released');

    if (!result) {
      return res.status(404).json({ success: false, message: 'Result not found' });
    }

    if (!result.exam_id.results_released) {
      return res.status(403).json({ success: false, message: 'Results have not been released by the admin yet' });
    }

    const examId = result.exam_id._id;

    // Fetch all questions for this exam
    const questions = await Question.find({ exam_id: examId }).sort({ _id: 1 });
    
    // Fetch student's answers for this exam
    const studentAnswers = await Answer.find({ exam_id: examId, student_id: studentId });
    
    // Map answers for quick lookup
    const answersMap = new Map();
    studentAnswers.forEach(ans => {
      answersMap.set(ans.question_id.toString(), ans.answer_text);
    });

    // Combine data
    const detailedReport = questions.map(q => {
      const studentAns = answersMap.get(q._id.toString()) || 'Not Answered';
      const isCorrect = q.question_type === 'MCQ' && studentAns.toUpperCase() === q.correct_option;
      
      return {
        question_id: q._id.toString(),
        question_text: q.question_text,
        question_type: q.question_type,
        options: {
          A: q.option_a,
          B: q.option_b,
          C: q.option_c,
          D: q.option_d
        },
        correct_option: q.correct_option,
        student_answer: studentAns,
        is_correct: isCorrect,
        marks_awarded: isCorrect ? (q.marks || 1) : 0,
        total_marks: q.marks || 1
      };
    });

    res.json({ 
      success: true, 
      exam_title: result.exam_id.title,
      total_score: result.mcq_score,
      total_possible: result.mcq_total,
      details: detailedReport 
    });

  } catch (error) {
    console.error('Student detailed results error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching detailed results' });
  }
});

module.exports = router;

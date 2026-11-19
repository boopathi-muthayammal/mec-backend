const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const Course = require('../models/Course');
const User = require('../models/User');
const ExcelJS = require('exceljs');
const {
  UnitTest,
  CIAMark,
  VivaMark,
  InternalMark,
  EndSemMark,
  IndirectAssessment
} = require('../models/MarksNew');
const ExamPattern = require('../models/ExamPattern');

const DEFAULT_PATTERNS = {
  unitTest: {
    examType: 'unitTest',
    name: 'Unit Test (UNIT I - V)',
    totalMax: 30,
    questions: [
      { qNo: 1, maxMarks: 2, co: 'CO1' },
      { qNo: 2, maxMarks: 2, co: 'CO1' },
      { qNo: 3, maxMarks: 2, co: 'CO1' },
      { qNo: 4, maxMarks: 2, co: 'CO1' },
      { qNo: 5, maxMarks: 2, co: 'CO1' },
      { qNo: 6, maxMarks: 10, co: 'CO1' },
      { qNo: 7, maxMarks: 10, co: 'CO1' }
    ]
  },
  cia1_2: {
    examType: 'cia1_2',
    name: 'CIA 1 & CIA 2 Exam',
    totalMax: 50,
    questions: [
      ...Array.from({ length: 10 }, (_, i) => ({ qNo: i + 1, maxMarks: 2, co: i < 5 ? 'CO1' : 'CO2' })),
      { qNo: 11, maxMarks: 15, co: 'CO1' },
      { qNo: 12, maxMarks: 15, co: 'CO2' }
    ]
  },
  cia3: {
    examType: 'cia3',
    name: 'CIA 3 / Model Exam',
    totalMax: 100,
    questions: [
      ...Array.from({ length: 10 }, (_, i) => ({ qNo: i + 1, maxMarks: 2, co: `CO${(i % 5) + 1}` })),
      { qNo: 11, maxMarks: 16, co: 'CO1' },
      { qNo: 12, maxMarks: 16, co: 'CO2' },
      { qNo: 13, maxMarks: 16, co: 'CO3' },
      { qNo: 14, maxMarks: 16, co: 'CO4' },
      { qNo: 15, maxMarks: 16, co: 'CO5' }
    ]
  }
};

const facultyOnly = requireAuth(['faculty', 'admin']);
const anyAuth = requireAuth(['faculty', 'admin', 'hod', 'student']);

// ============================================================
//  EXAM PATTERNS (Question Max Marks setup by Admin/Faculty)
// ============================================================
router.get('/patterns', anyAuth, async (req, res) => {
  try {
    const list = await ExamPattern.find();
    const result = JSON.parse(JSON.stringify(DEFAULT_PATTERNS));
    for (const p of list) {
      result[p.examType] = p;
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/patterns/:examType', facultyOnly, async (req, res) => {
  try {
    const { examType } = req.params;
    const { name, questions } = req.body;
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'Questions array is required' });
    }
    const totalMax = questions.reduce((sum, q) => sum + (Number(q.maxMarks) || 0), 0);
    const pattern = await ExamPattern.findOneAndUpdate(
      { examType },
      {
        examType,
        name: name || DEFAULT_PATTERNS[examType]?.name || examType,
        totalMax,
        questions: questions.map((q, idx) => ({
          qNo: q.qNo || (idx + 1),
          maxMarks: Number(q.maxMarks) || 0,
          co: q.co || 'CO1'
        })),
        updatedBy: req.session.userId
      },
      { upsert: true, new: true, runValidators: true }
    );
    res.json(pattern);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ============================================================
//  HELPER: get students for a course
// ============================================================
async function getCourseStudents(courseId) {
  const course = await Course.findById(courseId);
  if (!course) throw new Error('Course not found');
  // Match students by Batch & Department, and exclude any student removed from this specific semester!
  const query = {
    role: 'student',
    department: course.department,
    batch: course.batch,
    isActive: true
  };
  if (course.semester) {
    query.excludedSemesters = { $ne: Number(course.semester) };
  }
  return User.find(query).select('name rollNumber email section excludedSemesters').sort({ rollNumber: 1 });
}

// ============================================================
//  UNIT TEST MARKS  (UNIT I – V)
//  Each unit: 7 questions  Q1-Q5 = 2 marks, Q6-Q7 = 10 marks  -> Total 30
//  CO assignment: UNIT1->CO1, UNIT2->CO2, ..., UNIT5->CO5
// ============================================================

// GET all unit marks for a course (optional ?unitNo=1)
router.get('/unit/:courseId', facultyOnly, async (req, res) => {
  try {
    const filter = { course: req.params.courseId };
    if (req.query.unitNo) filter.unitNo = Number(req.query.unitNo);
    const marks = await UnitTest.find(filter)
      .populate('student', 'name rollNumber section')
      .sort({ unitNo: 1 });
    res.json(marks);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST / save bulk unit marks for one unit
// Body: { unitNo, co, marksData: [{ studentId, questions:[{qNo,marksObtained}] }] }
router.post('/unit/:courseId/bulk', facultyOnly, async (req, res) => {
  try {
    const { unitNo, co, marksData } = req.body;
    if (!unitNo || !co || !Array.isArray(marksData))
      return res.status(400).json({ message: 'unitNo, co and marksData required' });

    const defaultMaxMarks = [2, 2, 2, 2, 2, 10, 10];
    const results = { saved: 0, errors: [] };
    for (const md of marksData) {
      try {
        const questions = (md.questions && md.questions.length > 0)
          ? md.questions.map((q, idx) => ({
              qNo: q.qNo || (idx + 1),
              co: q.co || co,
              maxMarks: Number(q.maxMarks) || (defaultMaxMarks[idx] ?? 10),
              marksObtained: Number(q.marksObtained) || 0
            }))
          : defaultMaxMarks.map((maxMarks, idx) => ({
              qNo: idx + 1,
              co,
              maxMarks,
              marksObtained: md.questions?.[idx]?.marksObtained ?? 0
            }));
        const totalObtained = questions.reduce((s, q) => s + q.marksObtained, 0);
        const totalMax = questions.reduce((s, q) => s + q.maxMarks, 0);

        await UnitTest.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId, unitNo },
          { co, questions, totalObtained, totalMax, enteredBy: req.session.userId },
          { upsert: true, new: true, runValidators: true }
        );
        results.saved++;
      } catch (e) {
        results.errors.push({ studentId: md.studentId, error: e.message });
      }
    }
    res.json(results);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  CIA MARKS  (CIA 1, CIA 2, CIA 3/Model Exam)
//
//  CIA 1: Q1-Q10 (2m) + Q11(15m,CO1) + Q12(15m,CO2) = 50
//  CIA 2: Q1-Q10 (2m) + Q11(15m,CO3) + Q12(15m,CO4) = 50
//  CIA 3: Q1-Q10 (2m) + Q11-Q15 (16m each, CO1-CO5) = 100
// ============================================================

router.get('/cia/:courseId', facultyOnly, async (req, res) => {
  try {
    const filter = { course: req.params.courseId };
    if (req.query.ciaNo) filter.ciaNo = Number(req.query.ciaNo);
    const marks = await CIAMark.find(filter)
      .populate('student', 'name rollNumber section')
      .sort({ ciaNo: 1 });
    res.json(marks);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST bulk CIA marks
// Body: { ciaNo, marksData: [{ studentId, coWiseMarks:[{co, marksObtained, maxMarks}] }] }
router.post('/cia/:courseId/bulk', facultyOnly, async (req, res) => {
  try {
    const { ciaNo, marksData } = req.body;
    if (!ciaNo || !Array.isArray(marksData))
      return res.status(400).json({ message: 'ciaNo and marksData required' });

    const totalMax = ciaNo <= 2 ? 50 : 100;
    const results = { saved: 0, errors: [] };
    for (const md of marksData) {
      try {
        const totalObtained = md.totalObtained ??
          (md.coWiseMarks || []).reduce((s, c) => s + (c.marksObtained || 0), 0);

        const updateDoc = {
          coWiseMarks: md.coWiseMarks || [],
          totalObtained,
          totalMax,
          enteredBy: req.session.userId
        };
        if (Array.isArray(md.questions) && md.questions.length > 0) {
          updateDoc.questions = md.questions;
        }

        await CIAMark.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId, ciaNo },
          updateDoc,
          { upsert: true, new: true, runValidators: true }
        );
        results.saved++;
      } catch (e) {
        results.errors.push({ studentId: md.studentId, error: e.message });
      }
    }
    res.json(results);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  VIVA VOCE  (max 100)
// ============================================================
router.get('/viva/:courseId', facultyOnly, async (req, res) => {
  try {
    const marks = await VivaMark.find({ course: req.params.courseId })
      .populate('student', 'name rollNumber section');
    res.json(marks);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/viva/:courseId/bulk', facultyOnly, async (req, res) => {
  try {
    const { marksData } = req.body;
    if (!Array.isArray(marksData))
      return res.status(400).json({ message: 'marksData required' });

    const results = { saved: 0, errors: [] };
    for (const md of marksData) {
      try {
        await VivaMark.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId },
          { marksObtained: md.marksObtained ?? 0, maxMarks: 100, enteredBy: req.session.userId },
          { upsert: true, new: true }
        );
        results.saved++;
      } catch (e) {
        results.errors.push({ studentId: md.studentId, error: e.message });
      }
    }
    res.json(results);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  END SEMESTER EXAM  (University Exam) max 100
// ============================================================
router.get('/endsem/:courseId', facultyOnly, async (req, res) => {
  try {
    const marks = await EndSemMark.find({ course: req.params.courseId })
      .populate('student', 'name rollNumber section');
    const course = await Course.findById(req.params.courseId)
      .select('name code batch semester department cos gradingSystem');
    res.json({ marks, course });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/endsem/:courseId/bulk', facultyOnly, async (req, res) => {
  try {
    const { marksData } = req.body;
    if (!Array.isArray(marksData))
      return res.status(400).json({ message: 'marksData required' });

    const results = { saved: 0, errors: [] };
    for (const md of marksData) {
      try {
        const totalObtained = md.totalObtained ??
          (md.questions && md.questions.length > 0
            ? md.questions.reduce((s, q) => s + (q.marksObtained || 0), 0)
            : (md.coWiseMarks || []).reduce((s, c) => s + (c.marksObtained || 0), 0));

        let coWiseMarks = md.coWiseMarks;
        if (md.questions && md.questions.length > 0) {
          const coMap = {};
          for (const q of md.questions) {
            if (!coMap[q.co]) coMap[q.co] = { co: q.co, marksObtained: 0, maxMarks: 0 };
            coMap[q.co].marksObtained += (q.marksObtained || 0);
            coMap[q.co].maxMarks += (q.maxMarks || 0);
          }
          coWiseMarks = Object.values(coMap);
        }

        await EndSemMark.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId },
          {
            grade: md.grade ? String(md.grade).trim().toUpperCase() : undefined,
            questions: md.questions || [],
            coWiseMarks: coWiseMarks || [],
            totalObtained,
            totalMax: 100,
            enteredBy: req.session.userId
          },
          { upsert: true, new: true }
        );
        results.saved++;
      } catch (e) {
        results.errors.push({ studentId: md.studentId, error: e.message });
      }
    }
    res.json(results);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  INTERNAL MARK (IM) SHEET  — GET computed view
//
//  Columns: S.No | Reg No | Name |
//           ASS I(30) | ASS II(30) | CIA I(50) | CIA I IM(10) |
//           ASS III(30) | ASS IV(30) | CIA II(50) | CIA II IM(10) |
//           ASS V(30) | CIA III(100) | CIA III IM(10) | MKC(10) | TOTAL(40)
//
//  Formula:
//    CIA_x_IM = round(CIA_x_total / CIA_x_max * 10)
//    Ass contribution = round((ASS1+ASS2+ASS3+ASS4+ASS5)/150 * 20)
//    CIA contribution = round((CIA1_IM + CIA2_IM + CIA3_IM)/30 * 20)
//    TOTAL(40) = Ass_contrib + CIA_contrib + MKC
// ============================================================
router.get('/im/:courseId', anyAuth, async (req, res) => {
  try {
    const students = await getCourseStudents(req.params.courseId);

    const [unitMarks, ciaMarks, imRecords] = await Promise.all([
      UnitTest.find({ course: req.params.courseId }),
      CIAMark.find({ course: req.params.courseId }),
      InternalMark.find({ course: req.params.courseId })
    ]);

    const imSheet = students.map(student => {
      const sid = student._id.toString();

      const ass = [1, 2, 3, 4, 5].map(u => {
        const m = unitMarks.find(x => x.student.toString() === sid && x.unitNo === u);
        return m ? m.totalObtained : 0;
      });

      const cia = [1, 2, 3].map(c => {
        const m = ciaMarks.find(x => x.student.toString() === sid && x.ciaNo === c);
        return m ? m.totalObtained : 0;
      });
      const ciaMax = [50, 50, 100];
      const ciaIM = cia.map((marks, i) => Math.round((marks / ciaMax[i]) * 10));

      const imRec = imRecords.find(x => x.student.toString() === sid);
      const mkc = imRec?.mkc ?? 0;

      const assTotal = ass.reduce((s, v) => s + v, 0);
      const assContrib = Math.round((assTotal / 150) * 20);
      const ciaContrib = ciaIM[0] + ciaIM[1] + ciaIM[2];
      const ciaContribScaled = Math.round((ciaContrib / 30) * 20);
      const total = Math.min(40, assContrib + ciaContribScaled + mkc);

      return {
        student: { _id: student._id, name: student.name, rollNumber: student.rollNumber, section: student.section },
        ass1: ass[0], ass2: ass[1], ass3: ass[2], ass4: ass[3], ass5: ass[4],
        cia1: cia[0], cia1IM: ciaIM[0],
        cia2: cia[1], cia2IM: ciaIM[1],
        cia3: cia[2], cia3IM: ciaIM[2],
        mkc,
        totalInternal: total
      };
    });

    res.json(imSheet);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST calculate & save internal marks
router.post('/im/:courseId/calculate', facultyOnly, async (req, res) => {
  try {
    const students = await getCourseStudents(req.params.courseId);
    const [unitMarks, ciaMarks, imRecords] = await Promise.all([
      UnitTest.find({ course: req.params.courseId }),
      CIAMark.find({ course: req.params.courseId }),
      InternalMark.find({ course: req.params.courseId })
    ]);

    let saved = 0;
    for (const student of students) {
      const sid = student._id.toString();
      const ass = [1, 2, 3, 4, 5].map(u => {
        const m = unitMarks.find(x => x.student.toString() === sid && x.unitNo === u);
        return m ? m.totalObtained : 0;
      });
      const cia = [1, 2, 3].map(c => {
        const m = ciaMarks.find(x => x.student.toString() === sid && x.ciaNo === c);
        return m ? m.totalObtained : 0;
      });
      const ciaMax = [50, 50, 100];
      const ciaIM = cia.map((marks, i) => Math.round((marks / ciaMax[i]) * 10));
      const imRec = imRecords.find(x => x.student.toString() === sid);
      const mkc = imRec?.mkc ?? 0;

      const assContrib = Math.round((ass.reduce((s, v) => s + v, 0) / 150) * 20);
      const ciaContribScaled = Math.round(((ciaIM[0] + ciaIM[1] + ciaIM[2]) / 30) * 20);
      const total = Math.min(40, assContrib + ciaContribScaled + mkc);

      await InternalMark.findOneAndUpdate(
        { student: student._id, course: req.params.courseId },
        { internalMark: total, enteredBy: req.session.userId },
        { upsert: true, new: true }
      );
      saved++;
    }
    res.json({ saved });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  CO ATTAINMENT
// ============================================================
router.get('/co-attainment/:courseId', anyAuth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const threshold = Number(req.query.threshold) || 60;
    const students = await getCourseStudents(req.params.courseId);
    if (students.length === 0) return res.json([]);

    const [unitMarks, ciaMarks, endSemMarks] = await Promise.all([
      UnitTest.find({ course: req.params.courseId }),
      CIAMark.find({ course: req.params.courseId }),
      EndSemMark.find({ course: req.params.courseId })
    ]);

    const coUnitMap = { CO1: 1, CO2: 2, CO3: 3, CO4: 4, CO5: 5 };
    const coCIAMap = { CO1: [1, 3], CO2: [1, 3], CO3: [2, 3], CO4: [2, 3], CO5: [3] };

    const coList = course.cos?.length > 0
      ? course.cos.map(c => c.coNumber)
      : ['CO1', 'CO2', 'CO3', 'CO4', 'CO5'];

    const attainments = coList.map(co => {
      const unitNo = coUnitMap[co];
      const ciaList = coCIAMap[co] || [3];
      let attainedCount = 0;
      let totalWithData = 0;

      for (const student of students) {
        const sid = student._id.toString();

        const unitMark = unitMarks.find(x => x.student.toString() === sid && x.unitNo === unitNo);
        const assScore = unitMark ? (unitMark.totalObtained / 30) * 100 : null;

        let ciaScores = [];
        for (const ciaNo of ciaList) {
          const ciaMark = ciaMarks.find(x => x.student.toString() === sid && x.ciaNo === ciaNo);
          if (ciaMark) {
            const coMark = ciaMark.coWiseMarks?.find(c => c.co === co);
            if (coMark && coMark.maxMarks > 0) {
              ciaScores.push((coMark.marksObtained / coMark.maxMarks) * 100);
            } else {
              const maxT = ciaNo <= 2 ? 50 : 100;
              if (ciaMark.totalObtained > 0)
                ciaScores.push((ciaMark.totalObtained / maxT) * 100);
            }
          }
        }
        const ciaScore = ciaScores.length > 0
          ? ciaScores.reduce((s, v) => s + v, 0) / ciaScores.length : null;

        const endSemMark = endSemMarks.find(x => x.student.toString() === sid);
        let endScore = null;
        if (endSemMark) {
          const coMark = endSemMark.coWiseMarks?.find(c => c.co === co);
          if (coMark && coMark.maxMarks > 0)
            endScore = (coMark.marksObtained / coMark.maxMarks) * 100;
        }

        const weights = [];
        const scores = [];
        if (assScore !== null) { weights.push(0.4); scores.push(assScore); }
        if (ciaScore !== null) { weights.push(0.3); scores.push(ciaScore); }
        if (endScore !== null) { weights.push(0.3); scores.push(endScore); }
        if (weights.length === 0) continue;

        const weightSum = weights.reduce((s, w) => s + w, 0);
        const weightedScore = scores.reduce((s, v, i) => s + v * weights[i], 0) / weightSum;
        totalWithData++;
        if (weightedScore >= threshold) attainedCount++;
      }

      const directPct = totalWithData > 0 ? (attainedCount / totalWithData) * 100 : 0;
      const level = directPct >= 80 ? 3 : directPct >= 70 ? 2 : directPct >= 60 ? 1 : 0;

      return {
        co,
        totalStudents: totalWithData,
        attainedCount,
        directAttainmentPct: parseFloat(directPct.toFixed(2)),
        attainmentLevel: level,
        threshold
      };
    });

    res.json(attainments);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  STUDENTS list helper
// ============================================================
router.get('/students/:courseId', facultyOnly, async (req, res) => {
  try {
    const students = await getCourseStudents(req.params.courseId);
    res.json(students);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  INDIRECT ASSESSMENT
// ============================================================
router.post('/indirect/:courseId/bulk', facultyOnly, async (req, res) => {
  try {
    const { marksData } = req.body;
    const results = { saved: 0, errors: [] };
    for (const md of marksData) {
      try {
        await IndirectAssessment.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId },
          { coRatings: md.coRatings },
          { upsert: true, new: true }
        );
        results.saved++;
      } catch (e) {
        results.errors.push({ studentId: md.studentId, error: e.message });
      }
    }
    res.json(results);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.get('/indirect/:courseId', anyAuth, async (req, res) => {
  try {
    const records = await IndirectAssessment.find({ course: req.params.courseId })
      .populate('student', 'name rollNumber');
    res.json(records);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ============================================================
//  EXCEL PARSER FOR TOTAL MARKS (Upload & Auto-Split)
// ============================================================
router.post('/parse-excel-totals', facultyOnly, async (req, res) => {
  try {
    const { base64File } = req.body;
    if (!base64File) return res.status(400).json({ message: 'Excel file required' });

    const cleanBase64 = String(base64File).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const records = [];
    let parsed = false;

    // 1. Try ExcelJS
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      if (worksheet) {
        let rollCol = -1, markCol = -1, headerRowIndex = -1;
        worksheet.eachRow((row, rowNumber) => {
          const values = row.values;
          if (headerRowIndex === -1 && rowNumber <= 10) {
            for (let i = 1; i < values.length; i++) {
              const val = String(values[i] || '').trim().toLowerCase();
              if (/roll|reg|register|htno|student\s*id/.test(val)) rollCol = i;
              else if (/total\s*mark|total|marks|score|obtained/.test(val)) markCol = i;
            }
            if (rollCol !== -1 && markCol !== -1) {
              headerRowIndex = rowNumber;
              return;
            }
          }

          if (headerRowIndex !== -1 && rowNumber > headerRowIndex) {
            const rollNumber = String(values[rollCol] || '').trim().toUpperCase();
            const totalMarkRaw = values[markCol];
            const totalMark = Number(totalMarkRaw);
            if (rollNumber && !isNaN(totalMark) && totalMarkRaw !== '' && totalMarkRaw !== null) {
              records.push({ rollNumber, totalMark });
            }
          }
        });

        // Fallback for simple 2-column sheets without header: [RollNumber, TotalMark]
        if (records.length === 0) {
          worksheet.eachRow((row) => {
            const cells = [];
            row.eachCell(c => cells.push(c.value));
            if (cells.length >= 2) {
              const c0 = String(cells[0] || '').trim().toUpperCase();
              const c1 = Number(cells[1]);
              if (!/roll|reg|name/i.test(c0) && !isNaN(c1)) {
                records.push({ rollNumber: c0, totalMark: c1 });
              }
            }
          });
        }
        parsed = records.length > 0;
      }
    } catch (xlsxErr) {
      // Fallback to CSV
    }

    // 2. CSV fallback
    if (!parsed || records.length === 0) {
      const text = buffer.toString('utf-8');
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let rollCol = -1, markCol = -1, headerFound = false;

      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(/[,\t]+/).map(p => p.trim().replace(/^["']|["']$/g, ''));
        if (!headerFound && i <= 5) {
          for (let j = 0; j < parts.length; j++) {
            const val = parts[j].toLowerCase();
            if (/roll|reg|register|student\s*id/.test(val)) rollCol = j;
            else if (/total|mark|score|obtained/.test(val)) markCol = j;
          }
          if (rollCol !== -1 && markCol !== -1) {
            headerFound = true;
            continue;
          }
        }

        if (headerFound) {
          const rollNumber = String(parts[rollCol] || '').toUpperCase();
          const totalMark = Number(parts[markCol]);
          if (rollNumber && !isNaN(totalMark)) {
            records.push({ rollNumber, totalMark });
          }
        } else if (parts.length >= 2) {
          const c0 = parts[0].toUpperCase();
          const c1 = Number(parts[1]);
          if (!/roll|reg|name/i.test(c0) && !isNaN(c1)) {
            records.push({ rollNumber: c0, totalMark: c1 });
          }
        }
      }
    }

    if (records.length === 0) {
      return res.status(400).json({ message: 'No student marks found. Ensure columns include Register Number and Total Mark.' });
    }

    res.json({ success: true, count: records.length, records });
  } catch (error) {
    res.status(500).json({ message: 'Failed to parse Excel file: ' + error.message });
  }
});

// ============================================================
//  EXPORT EXCEL FOR MARKS (Download .xlsx)
// ============================================================
router.post('/export-excel', facultyOnly, async (req, res) => {
  try {
    const { title, sheetName = 'Marks Sheet', filename = 'Marks_Report.xlsx', headers, rows } = req.body;
    if (!Array.isArray(headers) || !Array.isArray(rows)) {
      return res.status(400).json({ message: 'headers and rows required' });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AttainTrack OBE System';
    const worksheet = workbook.addWorksheet(sheetName);

    // Title Row
    if (title) {
      const titleRow = worksheet.addRow([title]);
      titleRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
      titleRow.height = 26;
      worksheet.mergeCells(1, 1, 1, headers.length);
      worksheet.getCell(1, 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' } // Dark Slate
      };
      worksheet.addRow([]); // Blank spacer
    }

    // Header Row
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF3B82F6' } // Primary Blue
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Data Rows
    rows.forEach(r => {
      const row = worksheet.addRow(r);
      row.alignment = { vertical: 'middle' };
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
        if (typeof cell.value === 'number' || colNumber === 1 || colNumber === 2) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    // Column widths
    worksheet.columns.forEach((column, i) => {
      let maxLen = headers[i] ? String(headers[i]).length : 10;
      rows.forEach(r => {
        const val = r[i];
        if (val !== undefined && val !== null) {
          maxLen = Math.max(maxLen, String(val).length);
        }
      });
      column.width = Math.max(maxLen + 4, 10);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: 'Export failed: ' + error.message });
  }
});

// Download sample total marks template
router.get('/template/total-marks', facultyOnly, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Total Marks');
    ws.columns = [
      { header: 'Register Number', key: 'rollNumber', width: 22 },
      { header: 'Student Name', key: 'name', width: 28 },
      { header: 'Total Mark', key: 'totalMark', width: 16 }
    ];
    ws.addRow({ rollNumber: '25CS001', name: 'AAGASH P B', totalMark: 45 });
    ws.addRow({ rollNumber: '25CS002', name: 'ABHISHEK A S', totalMark: 38 });
    ws.addRow({ rollNumber: '25CS003', name: 'ABINOW M S', totalMark: 42 });

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="total_marks_template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Download sample End Semester marks template (Roll No, Name, Grade, Total Mark)
router.get('/template/endsem-marks', facultyOnly, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('End Sem Grades & Marks');
    ws.columns = [
      { header: 'Register Number', key: 'rollNumber', width: 22 },
      { header: 'Student Name', key: 'name', width: 28 },
      { header: 'Grade', key: 'grade', width: 14 },
      { header: 'Total Mark (Optional)', key: 'totalMark', width: 22 }
    ];
    ws.addRow({ rollNumber: '25CS001', name: 'AAGASH P B', grade: 'A+', totalMark: 85 });
    ws.addRow({ rollNumber: '25CS002', name: 'ABHISHEK A S', grade: 'A', totalMark: 76 });
    ws.addRow({ rollNumber: '25CS003', name: 'ABINOW M S', grade: 'B+', totalMark: 65 });
    ws.addRow({ rollNumber: '25CS004', name: 'ABISHEK A', grade: 'O', totalMark: 95 });

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366F1' } };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="endsem_grades_template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Parse Excel file for End Semester (handles both Grade and Total Mark)
router.post('/parse-excel-endsem', facultyOnly, async (req, res) => {
  try {
    const { base64File, gradingSystem } = req.body;
    if (!base64File) {
      return res.status(400).json({ message: 'base64File is required' });
    }

    const base64Data = base64File.replace(/^data:.*?;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const gradesList = gradingSystem?.grades || [
      { grade: 'O', minMark: 91, maxMark: 100 },
      { grade: 'A+', minMark: 81, maxMark: 90 },
      { grade: 'A', minMark: 71, maxMark: 80 },
      { grade: 'B+', minMark: 61, maxMark: 70 },
      { grade: 'B', minMark: 50, maxMark: 60 },
      { grade: 'C', minMark: 45, maxMark: 49 },
      { grade: 'U', minMark: 0, maxMark: 44 },
      { grade: 'AB', minMark: 0, maxMark: 0 }
    ];

    const records = [];
    let parsed = false;

    try {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      if (jsonData && jsonData.length > 0) {
        let rollCol = -1, gradeCol = -1, markCol = -1, headerRowIdx = -1;

        for (let i = 0; i < Math.min(jsonData.length, 10); i++) {
          const row = jsonData[i];
          if (!Array.isArray(row)) continue;
          for (let j = 0; j < row.length; j++) {
            const val = String(row[j] || '').trim().toLowerCase();
            if (/roll|reg|register|student\s*id/i.test(val)) rollCol = j;
            else if (/^grade|letter\s*grade|final\s*grade/i.test(val)) gradeCol = j;
            else if (/total|mark|score|obtained|100/i.test(val)) markCol = j;
          }
          if (rollCol !== -1 && (gradeCol !== -1 || markCol !== -1)) {
            headerRowIdx = i;
            break;
          }
        }

        const startIdx = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;
        for (let i = startIdx; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!Array.isArray(row) || row.length === 0) continue;

          let rollNumber = '';
          let grade = '';
          let totalMark = NaN;

          if (headerRowIdx !== -1) {
            rollNumber = String(row[rollCol] || '').trim().toUpperCase();
            if (gradeCol !== -1) grade = String(row[gradeCol] || '').trim().toUpperCase();
            if (markCol !== -1) totalMark = Number(row[markCol]);
          } else {
            // Heuristic
            rollNumber = String(row[0] || '').trim().toUpperCase();
            const val1 = String(row[1] || '').trim().toUpperCase();
            const val2 = Number(row[2]);
            if (/^[OABCU]|A\+|B\+|RA|SA|W$/i.test(val1)) {
              grade = val1;
              if (!isNaN(val2)) totalMark = val2;
            } else if (!isNaN(Number(val1))) {
              totalMark = Number(val1);
            }
          }

          if (!rollNumber || /roll|reg|name|s\.?no/i.test(rollNumber)) continue;

          // If grade is present but not totalMark, calculate totalMark from range
          if (grade && isNaN(totalMark)) {
            const foundGrade = gradesList.find(g => g.grade.toUpperCase() === grade.toUpperCase());
            if (foundGrade) {
              totalMark = Math.round((foundGrade.minMark + foundGrade.maxMark) / 2);
            }
          }

          // If totalMark is present but not grade, find matching grade
          if (!grade && !isNaN(totalMark)) {
            const foundGrade = gradesList.find(g => totalMark >= g.minMark && totalMark <= g.maxMark);
            if (foundGrade) grade = foundGrade.grade;
          }

          if (rollNumber && (!isNaN(totalMark) || grade)) {
            records.push({ rollNumber, grade, totalMark: isNaN(totalMark) ? 0 : totalMark });
          }
        }
        parsed = records.length > 0;
      }
    } catch (e) {
      // Fallback
    }

    if (records.length === 0) {
      return res.status(400).json({ message: 'No student grades or marks found. Ensure columns include Register Number and Grade or Total Mark.' });
    }

    res.json({ success: true, count: records.length, records });
  } catch (error) {
    res.status(500).json({ message: 'Failed to parse Excel file: ' + error.message });
  }
});

module.exports = router;

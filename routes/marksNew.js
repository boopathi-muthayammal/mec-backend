const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const Course = require('../models/Course');
const User = require('../models/User');
const {
  UnitTest,
  CIAMark,
  VivaMark,
  InternalMark,
  EndSemMark,
  IndirectAssessment
} = require('../models/MarksNew');

const facultyOnly = requireAuth(['faculty', 'admin']);
const anyAuth = requireAuth(['faculty', 'admin', 'hod', 'student']);

// ============================================================
//  HELPER: get students for a course
// ============================================================
async function getCourseStudents(courseId) {
  const course = await Course.findById(courseId);
  if (!course) throw new Error('Course not found');
  return User.find({
    role: 'student',
    department: course.department,
    semester: course.semester,
    batch: course.batch,
    isActive: true
  }).select('name rollNumber email section').sort({ rollNumber: 1 });
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
        const questions = defaultMaxMarks.map((maxMarks, idx) => ({
          qNo: idx + 1,
          co,
          maxMarks,
          marksObtained: md.questions?.[idx]?.marksObtained ?? 0
        }));
        const totalObtained = questions.reduce((s, q) => s + q.marksObtained, 0);

        await UnitTest.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId, unitNo },
          { co, questions, totalObtained, totalMax: 30, enteredBy: req.session.userId },
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

        await CIAMark.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId, ciaNo },
          { coWiseMarks: md.coWiseMarks || [], totalObtained, totalMax, enteredBy: req.session.userId },
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
    res.json(marks);
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
          (md.coWiseMarks || []).reduce((s, c) => s + (c.marksObtained || 0), 0);

        await EndSemMark.findOneAndUpdate(
          { student: md.studentId, course: req.params.courseId },
          { coWiseMarks: md.coWiseMarks || [], totalObtained, totalMax: 100, enteredBy: req.session.userId },
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

module.exports = router;

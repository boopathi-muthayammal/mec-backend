const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const COMapping = require('../models/COMapping');
const Marks = require('../models/Marks');
const Attainment = require('../models/Attainment');
const User = require('../models/User');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { requireAuth } = require('./auth');

const facultyOnly = requireAuth(['faculty', 'admin']);

// ============ MY COURSES ============
router.get('/courses', facultyOnly, async (req, res) => {
  try {
    const courses = await Course.find({ faculty: req.session.userId, isActive: true })
      .populate('department', 'name code')
      .sort({ semester: 1 });
    res.json(courses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/courses/:id', facultyOnly, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('department', 'name code')
      .populate('faculty', 'name email');
    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.json(course);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ CO SETUP ============
router.put('/courses/:id/cos', facultyOnly, async (req, res) => {
  try {
    const { cos, assessmentWeights } = req.body;
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      { cos, assessmentWeights, totalCOs: cos.length },
      { new: true }
    );
    res.json(course);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ CO-PO MAPPING ============
router.get('/courses/:id/mapping', facultyOnly, async (req, res) => {
  try {
    const mapping = await COMapping.findOne({ course: req.params.id });
    res.json(mapping || null);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/courses/:id/mapping', facultyOnly, async (req, res) => {
  try {
    const { mappings } = req.body;
    const existing = await COMapping.findOne({ course: req.params.id });
    let result;
    if (existing) {
      result = await COMapping.findByIdAndUpdate(
        existing._id,
        { mappings, lastUpdatedBy: req.session.userId },
        { new: true }
      );
    } else {
      result = await COMapping.create({
        course: req.params.id,
        mappings,
        lastUpdatedBy: req.session.userId
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ STUDENTS IN COURSE ============
router.get('/courses/:id/students', facultyOnly, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Course not found' });
    const students = await User.find({
      role: 'student',
      department: course.department,
      semester: course.semester,
      batch: course.batch,
      isActive: true
    }).select('name rollNumber email section').sort({ rollNumber: 1 });
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ MARKS ENTRY ============
router.get('/courses/:id/marks', facultyOnly, async (req, res) => {
  try {
    const { assessmentType } = req.query;
    const filter = { course: req.params.id };
    if (assessmentType) filter.assessmentType = assessmentType;
    const marks = await Marks.find(filter)
      .populate('student', 'name rollNumber')
      .sort({ 'student.rollNumber': 1 });
    res.json(marks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/courses/:id/marks', facultyOnly, async (req, res) => {
  try {
    const { studentId, assessmentType, coWiseMarks } = req.body;
    const existing = await Marks.findOne({
      student: studentId,
      course: req.params.id,
      assessmentType
    });
    let result;
    if (existing) {
      existing.coWiseMarks = coWiseMarks;
      existing.enteredBy = req.session.userId;
      await existing.save();
      result = existing;
    } else {
      result = await Marks.create({
        student: studentId,
        course: req.params.id,
        assessmentType,
        coWiseMarks,
        enteredBy: req.session.userId
      });
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Bulk marks entry
router.post('/courses/:id/marks/bulk', facultyOnly, async (req, res) => {
  try {
    const { assessmentType, marksData } = req.body; // marksData: [{studentId, coWiseMarks}]
    const results = { saved: 0, errors: [] };
    for (const md of marksData) {
      try {
        await Marks.findOneAndUpdate(
          { student: md.studentId, course: req.params.id, assessmentType },
          { coWiseMarks: md.coWiseMarks, enteredBy: req.session.userId },
          { upsert: true, new: true, runValidators: true }
        );
        results.saved++;
      } catch (e) {
        results.errors.push({ studentId: md.studentId, error: e.message });
      }
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ CALCULATE ATTAINMENT ============
router.post('/courses/:id/calculate', facultyOnly, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (!course.cos || course.cos.length === 0) {
      return res.status(400).json({ message: 'Please define COs first' });
    }

    const threshold = req.body.threshold || 60;
    const indirectDefault = req.body.indirectAttainment || 70;

    // Get all students for this course
    const students = await User.find({
      role: 'student',
      department: course.department,
      semester: course.semester,
      batch: course.batch,
      isActive: true
    });
    const totalStudents = students.length;

    if (totalStudents === 0) {
      return res.status(400).json({ message: 'No students found for this course' });
    }

    // Get assessment weights
    const weights = course.assessmentWeights && course.assessmentWeights.length > 0
      ? course.assessmentWeights
      : [
          { type: 'CAT1', maxMarks: 50, weightage: 25 },
          { type: 'CAT2', maxMarks: 50, weightage: 25 },
          { type: 'Model', maxMarks: 100, weightage: 50 }
        ];

    const totalWeight = weights.reduce((s, w) => s + w.weightage, 0);

    // Get all marks for this course
    const allMarks = await Marks.find({ course: req.params.id }).populate('student');

    // CO-wise attainment calculation
    const coAttainments = [];
    for (const co of course.cos) {
      const coKey = co.coNumber;
      let studentScores = [];

      for (const student of students) {
        let weightedScore = 0;
        let totalWeightApplied = 0;

        for (const wt of weights) {
          const studentMarks = allMarks.find(
            m => m.student._id.toString() === student._id.toString() &&
                 m.assessmentType === wt.type
          );
          if (studentMarks) {
            const coMark = studentMarks.coWiseMarks.find(cm => cm.co === coKey);
            if (coMark && coMark.maxMarks > 0) {
              const percentage = (coMark.marksObtained / coMark.maxMarks) * 100;
              weightedScore += percentage * (wt.weightage / totalWeight);
              totalWeightApplied += wt.weightage;
            }
          }
        }

        if (totalWeightApplied > 0) {
          const normalizedScore = weightedScore * (totalWeight / totalWeightApplied);
          studentScores.push(normalizedScore);
        }
      }

      const attainedCount = studentScores.filter(s => s >= threshold).length;
      const directAttainment = studentScores.length > 0
        ? (attainedCount / studentScores.length) * 100 : 0;

      // Attainment level: 0-3
      let attainmentLevel = 0;
      if (directAttainment >= 80) attainmentLevel = 3;
      else if (directAttainment >= 70) attainmentLevel = 2;
      else if (directAttainment >= 60) attainmentLevel = 1;

      const finalAttainment = (directAttainment * 0.8) + (indirectDefault * 0.2);

      coAttainments.push({
        co: coKey,
        directAttainment: parseFloat(directAttainment.toFixed(2)),
        indirectAttainment: indirectDefault,
        finalAttainment: parseFloat(finalAttainment.toFixed(2)),
        attainmentLevel,
        isAttained: directAttainment >= threshold
      });
    }

    // PO attainment from CO-PO mapping
    const mapping = await COMapping.findOne({ course: req.params.id });
    const poAttainments = [];
    const psoAttainments = [];

    if (mapping && mapping.mappings.length > 0) {
      const poCount = course.totalPOs || 12;
      const psoCount = course.totalPSOs || 2;

      for (let i = 1; i <= poCount; i++) {
        const poKey = `po${i}`;
        let weightedSum = 0;
        let correlationSum = 0;

        for (const coMap of mapping.mappings) {
          const corr = coMap[poKey] || 0;
          if (corr > 0) {
            const coAtt = coAttainments.find(ca => ca.co === coMap.co);
            if (coAtt) {
              weightedSum += coAtt.finalAttainment * corr;
              correlationSum += corr;
            }
          }
        }

        const poAtt = correlationSum > 0 ? weightedSum / correlationSum : 0;
        let poLevel = 0;
        if (poAtt >= 80) poLevel = 3;
        else if (poAtt >= 70) poLevel = 2;
        else if (poAtt >= 60) poLevel = 1;

        poAttainments.push({
          po: `PO${i}`,
          attainment: parseFloat(poAtt.toFixed(2)),
          attainmentLevel: poLevel
        });
      }

      for (let i = 1; i <= psoCount; i++) {
        const psoKey = `pso${i}`;
        let weightedSum = 0;
        let correlationSum = 0;

        for (const coMap of mapping.mappings) {
          const corr = coMap[psoKey] || 0;
          if (corr > 0) {
            const coAtt = coAttainments.find(ca => ca.co === coMap.co);
            if (coAtt) {
              weightedSum += coAtt.finalAttainment * corr;
              correlationSum += corr;
            }
          }
        }

        const psoAtt = correlationSum > 0 ? weightedSum / correlationSum : 0;
        psoAttainments.push({
          pso: `PSO${i}`,
          attainment: parseFloat(psoAtt.toFixed(2)),
          attainmentLevel: psoAtt >= 80 ? 3 : psoAtt >= 70 ? 2 : psoAtt >= 60 ? 1 : 0
        });
      }
    }

    // Save or update attainment
    const attainment = await Attainment.findOneAndUpdate(
      { course: req.params.id },
      {
        totalStudents,
        threshold,
        coAttainments,
        poAttainments,
        psoAttainments,
        status: 'draft',
        calculatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.json(attainment);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ GET ATTAINMENT ============
router.get('/courses/:id/attainment', facultyOnly, async (req, res) => {
  try {
    const att = await Attainment.findOne({ course: req.params.id })
      .populate({ path: 'course', populate: [{ path: 'department', select: 'name code' }, { path: 'faculty', select: 'name' }] });
    if (!att) return res.status(404).json({ message: 'Attainment not calculated yet' });
    res.json(att);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ SUBMIT FOR HOD APPROVAL ============
router.put('/courses/:id/attainment/submit', facultyOnly, async (req, res) => {
  try {
    const att = await Attainment.findOneAndUpdate(
      { course: req.params.id },
      { status: 'submitted' },
      { new: true }
    );
    if (!att) return res.status(404).json({ message: 'Calculate attainment first' });
    res.json(att);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ EXPORT EXCEL ============
router.get('/courses/:id/export/excel', facultyOnly, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('department', 'name code')
      .populate('faculty', 'name');
    const att = await Attainment.findOne({ course: req.params.id });
    const mapping = await COMapping.findOne({ course: req.params.id });
    const allMarks = await Marks.find({ course: req.params.id })
      .populate('student', 'name rollNumber');

    if (!att) return res.status(404).json({ message: 'Attainment not calculated yet' });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Attainment Management System';

    // ---- Sheet 1: Course Info ----
    const ws1 = wb.addWorksheet('Course Info');
    ws1.addRows([
      ['COURSE ATTAINMENT REPORT'],
      [],
      ['Course Name', course.name],
      ['Course Code', course.code],
      ['Department', `${course.department.name} (${course.department.code})`],
      ['Faculty', course.faculty ? course.faculty.name : '-'],
      ['Semester', course.semester],
      ['Batch', course.batch],
      ['Academic Year', course.academicYear],
      ['Total Students', att.totalStudents],
      ['Threshold', `${att.threshold}%`],
      ['Generated On', new Date().toLocaleDateString()],
    ]);
    ws1.getRow(1).font = { bold: true, size: 14 };
    ws1.columns = [{ width: 20 }, { width: 40 }];

    // ---- Sheet 2: CO Definitions ----
    const ws2 = wb.addWorksheet('CO Definitions');
    ws2.addRow(['CO Number', 'Description', "Bloom's Level"]);
    ws2.getRow(1).font = { bold: true };
    for (const co of course.cos) {
      ws2.addRow([co.coNumber, co.description, co.blooms]);
    }
    ws2.columns = [{ width: 12 }, { width: 60 }, { width: 15 }];

    // ---- Sheet 3: CO-PO Mapping ----
    const ws3 = wb.addWorksheet('CO-PO Mapping');
    const poHeaders = ['CO'];
    for (let i = 1; i <= (course.totalPOs || 12); i++) poHeaders.push(`PO${i}`);
    for (let i = 1; i <= (course.totalPSOs || 2); i++) poHeaders.push(`PSO${i}`);
    ws3.addRow(poHeaders);
    ws3.getRow(1).font = { bold: true };
    if (mapping) {
      for (const m of mapping.mappings) {
        const row = [m.co];
        for (let i = 1; i <= (course.totalPOs || 12); i++) row.push(m[`po${i}`] || 0);
        for (let i = 1; i <= (course.totalPSOs || 2); i++) row.push(m[`pso${i}`] || 0);
        ws3.addRow(row);
      }
    }
    ws3.columns = poHeaders.map(() => ({ width: 6 }));

    // ---- Sheet 4: Student Marks ----
    const ws4 = wb.addWorksheet('Student Marks');
    const assessmentTypes = ['CAT1', 'CAT2', 'Model', 'Assignment', 'Lab'];
    const markHeaders = ['Roll No', 'Student Name'];
    for (const at of assessmentTypes) {
      for (const co of course.cos) {
        markHeaders.push(`${at}-${co.coNumber}`);
      }
    }
    ws4.addRow(markHeaders);
    ws4.getRow(1).font = { bold: true };

    const studentMap = {};
    for (const m of allMarks) {
      const key = m.student._id.toString();
      if (!studentMap[key]) {
        studentMap[key] = { name: m.student.name, rollNumber: m.student.rollNumber, marks: {} };
      }
      studentMap[key].marks[m.assessmentType] = m.coWiseMarks;
    }

    for (const [, student] of Object.entries(studentMap)) {
      const row = [student.rollNumber, student.name];
      for (const at of assessmentTypes) {
        for (const co of course.cos) {
          const coMark = student.marks[at]
            ? student.marks[at].find(cm => cm.co === co.coNumber)
            : null;
          row.push(coMark ? coMark.marksObtained : '-');
        }
      }
      ws4.addRow(row);
    }
    ws4.columns = markHeaders.map(() => ({ width: 12 }));

    // ---- Sheet 5: CO Attainment ----
    const ws5 = wb.addWorksheet('CO Attainment');
    ws5.addRow(['CO', 'Direct Attainment %', 'Indirect Attainment %', 'Final Attainment %', 'Level (0-3)', 'Attained?']);
    ws5.getRow(1).font = { bold: true };
    for (const ca of att.coAttainments) {
      const row = ws5.addRow([
        ca.co,
        ca.directAttainment,
        ca.indirectAttainment,
        ca.finalAttainment,
        ca.attainmentLevel,
        ca.isAttained ? 'YES' : 'NO'
      ]);
      if (ca.isAttained) {
        row.getCell(6).font = { color: { argb: 'FF008000' }, bold: true };
      } else {
        row.getCell(6).font = { color: { argb: 'FFFF0000' }, bold: true };
      }
    }
    ws5.columns = [{ width: 8 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 12 }, { width: 12 }];

    // ---- Sheet 6: PO Attainment ----
    const ws6 = wb.addWorksheet('PO Attainment');
    ws6.addRow(['PO/PSO', 'Attainment %', 'Level (0-3)']);
    ws6.getRow(1).font = { bold: true };
    for (const pa of att.poAttainments) {
      ws6.addRow([pa.po, pa.attainment, pa.attainmentLevel]);
    }
    for (const ps of att.psoAttainments) {
      ws6.addRow([ps.pso, ps.attainment, ps.attainmentLevel]);
    }
    ws6.columns = [{ width: 10 }, { width: 18 }, { width: 14 }];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attainment_${course.code}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ EXPORT PDF ============
router.get('/courses/:id/export/pdf', facultyOnly, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('department', 'name code')
      .populate('faculty', 'name');
    const att = await Attainment.findOne({ course: req.params.id });
    if (!att) return res.status(404).json({ message: 'Attainment not calculated yet' });

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=attainment_${course.code}.pdf`);
    doc.pipe(res);

    // Title
    doc.fontSize(18).font('Helvetica-Bold').text('COURSE ATTAINMENT REPORT', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11).font('Helvetica');

    // Course Info
    const info = [
      ['Course Name', course.name],
      ['Course Code', course.code],
      ['Department', `${course.department.name} (${course.department.code})`],
      ['Faculty', course.faculty ? course.faculty.name : '-'],
      ['Semester', course.semester],
      ['Batch', course.batch],
      ['Academic Year', course.academicYear],
      ['Total Students', att.totalStudents],
      ['Threshold', `${att.threshold}%`],
    ];
    for (const [label, value] of info) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(String(value));
    }

    doc.moveDown();
    doc.fontSize(14).font('Helvetica-Bold').text('CO Attainment', { underline: true });
    doc.moveDown(0.5);

    // CO Table
    const colWidths = [60, 110, 110, 110, 60, 65];
    const headers = ['CO', 'Direct %', 'Indirect %', 'Final %', 'Level', 'Attained'];
    let x = 50;
    doc.fontSize(10).font('Helvetica-Bold');
    headers.forEach((h, i) => { doc.text(h, x, doc.y, { width: colWidths[i], align: 'center' }); x += colWidths[i]; });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(570, doc.y).stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);

    for (const ca of att.coAttainments) {
      x = 50;
      const y = doc.y;
      const cols = [ca.co, ca.directAttainment, ca.indirectAttainment, ca.finalAttainment, ca.attainmentLevel, ca.isAttained ? 'YES' : 'NO'];
      cols.forEach((c, i) => {
        if (i === 5) doc.fillColor(ca.isAttained ? 'green' : 'red');
        doc.text(String(c), x, y, { width: colWidths[i], align: 'center' });
        doc.fillColor('black');
        x += colWidths[i];
      });
      doc.moveDown(0.5);
    }

    doc.moveDown();
    doc.fontSize(14).font('Helvetica-Bold').text('PO/PSO Attainment', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold');
    const poHeaders2 = ['PO/PSO', 'Attainment %', 'Level'];
    const poWidths = [80, 120, 80];
    x = 50;
    poHeaders2.forEach((h, i) => { doc.text(h, x, doc.y, { width: poWidths[i], align: 'center' }); x += poWidths[i]; });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(330, doc.y).stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);

    for (const pa of [...att.poAttainments, ...att.psoAttainments]) {
      x = 50;
      const y = doc.y;
      const vals = [pa.po || pa.pso, pa.attainment, pa.attainmentLevel];
      vals.forEach((v, i) => {
        doc.text(String(v), x, y, { width: poWidths[i], align: 'center' });
        x += poWidths[i];
      });
      doc.moveDown(0.5);
    }

    doc.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

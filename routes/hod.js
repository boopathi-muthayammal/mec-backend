const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Attainment = require('../models/Attainment');
const User = require('../models/User');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { requireAuth } = require('./auth');

const hodOnly = requireAuth(['hod']);

// ============ HOD DASHBOARD STATS ============
router.get('/stats', hodOnly, async (req, res) => {
  try {
    const hod = await User.findById(req.session.userId);
    const courses = await Course.find({ department: hod.department, isActive: true });
    const courseIds = courses.map(c => c._id);
    const attainments = await Attainment.find({ course: { $in: courseIds } });

    const approved = attainments.filter(a => a.status === 'approved').length;
    const pending = attainments.filter(a => a.status === 'submitted').length;
    const draft = attainments.filter(a => a.status === 'draft').length;

    res.json({
      totalCourses: courses.length,
      totalAttainments: attainments.length,
      approved, pending, draft,
      departmentId: hod.department
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ DEPARTMENT COURSES ============
router.get('/courses', hodOnly, async (req, res) => {
  try {
    const hod = await User.findById(req.session.userId);
    const courses = await Course.find({ department: hod.department, isActive: true })
      .populate('faculty', 'name email')
      .sort({ semester: 1, name: 1 });
    res.json(courses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ ATTAINMENT LIST FOR HOD ============
router.get('/attainments', hodOnly, async (req, res) => {
  try {
    const hod = await User.findById(req.session.userId);
    const courses = await Course.find({ department: hod.department, isActive: true });
    const courseIds = courses.map(c => c._id);
    const attainments = await Attainment.find({ course: { $in: courseIds } })
      .populate({ path: 'course', populate: { path: 'faculty', select: 'name' } })
      .sort({ updatedAt: -1 });
    res.json(attainments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ APPROVE / REJECT ============
router.put('/attainments/:id/approve', hodOnly, async (req, res) => {
  try {
    const att = await Attainment.findByIdAndUpdate(req.params.id, {
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: req.session.userId,
      hodRemarks: req.body.remarks || ''
    }, { new: true });
    res.json(att);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/attainments/:id/reject', hodOnly, async (req, res) => {
  try {
    const att = await Attainment.findByIdAndUpdate(req.params.id, {
      status: 'rejected',
      hodRemarks: req.body.remarks || ''
    }, { new: true });
    res.json(att);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ ATTAINMENT DETAIL ============
router.get('/attainments/:id', hodOnly, async (req, res) => {
  try {
    const att = await Attainment.findById(req.params.id)
      .populate({ path: 'course', populate: [{ path: 'department', select: 'name code' }, { path: 'faculty', select: 'name email' }] });
    if (!att) return res.status(404).json({ message: 'Not found' });
    res.json(att);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ EXPORT DEPARTMENT REPORT (EXCEL) ============
router.get('/export/excel', hodOnly, async (req, res) => {
  try {
    const hod = await User.findById(req.session.userId).populate('department');
    const courses = await Course.find({ department: hod.department._id, isActive: true })
      .populate('faculty', 'name');
    const courseIds = courses.map(c => c._id);
    const attainments = await Attainment.find({ course: { $in: courseIds } })
      .populate('course');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Attainment Management System';
    wb.created = new Date();

    // Summary sheet
    const ws = wb.addWorksheet('Department Summary');
    ws.addRow(['Department Attainment Report']);
    ws.addRow([`Department: ${hod.department.name} (${hod.department.code})`]);
    ws.addRow([`Generated: ${new Date().toLocaleDateString()}`]);
    ws.addRow([]);
    ws.addRow(['Course Code', 'Course Name', 'Faculty', 'Semester', 'Batch', 'Status', 'CO Attained', 'PO Avg']);

    for (const att of attainments) {
      const course = courses.find(c => c._id.toString() === att.course._id.toString());
      if (!course) continue;
      const coAttained = att.coAttainments.filter(c => c.isAttained).length;
      const poAvg = att.poAttainments.length
        ? (att.poAttainments.reduce((s, p) => s + p.attainment, 0) / att.poAttainments.length).toFixed(2)
        : 'N/A';
      ws.addRow([
        course.code, course.name,
        course.faculty ? course.faculty.name : '-',
        course.semester, course.batch,
        att.status.toUpperCase(),
        `${coAttained}/${att.coAttainments.length}`,
        poAvg
      ]);
    }

    // Style header
    ws.getRow(5).font = { bold: true };
    ws.columns.forEach(col => { col.width = 18; });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=dept_attainment_${hod.department.code}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

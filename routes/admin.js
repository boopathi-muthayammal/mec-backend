const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Department = require('../models/Department');
const Course = require('../models/Course');
const Attainment = require('../models/Attainment');
const AttainmentTemplate = require('../models/AttainmentTemplate');
const Batch = require('../models/Batch');
const GradingSystem = require('../models/GradingSystem');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { requireAuth } = require('./auth');

const adminOnly = requireAuth(['admin']);

// ============ DASHBOARD STATS ============
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const [userCount, deptCount, courseCount, attainmentCount] = await Promise.all([
      User.countDocuments({ isActive: true }),
      Department.countDocuments({ isActive: true }),
      Course.countDocuments({ isActive: true }),
      Attainment.countDocuments()
    ]);
    const roleCounts = await User.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    res.json({ userCount, deptCount, courseCount, attainmentCount, roleCounts });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ USER MANAGEMENT ============
router.get('/users', adminOnly, async (req, res) => {
  try {
    const { role, department } = req.query;
    const filter = { isActive: true };
    if (role) filter.role = role;
    if (department) filter.department = department;
    const users = await User.find(filter)
      .select('-password')
      .populate('department', 'name code')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/users', adminOnly, async (req, res) => {
  try {
    const { name, email, password, role, department, rollNumber, semester, batch, section } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' });
    const user = new User({ name, email, password, role, department, rollNumber, semester, batch, section });
    await user.save();
    const saved = await User.findById(user._id).select('-password').populate('department', 'name code');
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/users/:id', adminOnly, async (req, res) => {
  try {
    const { name, email, role, department, rollNumber, semester, batch, section, isActive } = req.body;
    const update = { name, email, role, department, rollNumber, semester, batch, section, isActive };
    if (req.body.password) {
      const bcrypt = require('bcryptjs');
      update.password = await bcrypt.hash(req.body.password, 10);
    }
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true })
      .select('-password').populate('department', 'name code');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/users/:id', adminOnly, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'User deactivated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ DEPARTMENT MANAGEMENT ============
router.get('/departments', adminOnly, async (req, res) => {
  try {
    const depts = await Department.find({ isActive: true }).populate('hod', 'name email');
    res.json(depts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/departments', adminOnly, async (req, res) => {
  try {
    const { name, code, hod } = req.body;
    const dept = new Department({ name, code, hod });
    await dept.save();
    const saved = await Department.findById(dept._id).populate('hod', 'name email');
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/departments/:id', adminOnly, async (req, res) => {
  try {
    const dept = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('hod', 'name email');
    res.json(dept);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/departments/:id', adminOnly, async (req, res) => {
  try {
    await Department.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Department deactivated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ COURSE MANAGEMENT ============
router.get('/courses', adminOnly, async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.batch) filter.batch = req.query.batch;
    if (req.query.semester) filter.semester = Number(req.query.semester);
    if (req.query.department) filter.department = req.query.department;
    const courses = await Course.find(filter)
      .populate('department', 'name code')
      .populate('faculty', 'name email')
      .populate('regulation', 'name code')
      .sort({ semester: 1, code: 1 });
    res.json(courses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/courses', adminOnly, async (req, res) => {
  try {
    const course = new Course(req.body);
    await course.save();
    const saved = await Course.findById(course._id)
      .populate('department', 'name code')
      .populate('faculty', 'name email');
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/courses/:id', adminOnly, async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('department', 'name code')
      .populate('faculty', 'name email');
    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.json(course);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/courses/:id', adminOnly, async (req, res) => {
  try {
    await Course.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Course deactivated' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const DEFAULT_GRADING_SYSTEMS = {
  anna_univ_r2021: {
    systemKey: 'anna_univ_r2021',
    systemName: 'Anna University R2021 (10-Point Letter Grade)',
    grades: [
      { grade: 'O', description: 'Outstanding', minMark: 91, maxMark: 100, gradePoint: 10 },
      { grade: 'A+', description: 'Excellent', minMark: 81, maxMark: 90, gradePoint: 9 },
      { grade: 'A', description: 'Very Good', minMark: 71, maxMark: 80, gradePoint: 8 },
      { grade: 'B+', description: 'Good', minMark: 61, maxMark: 70, gradePoint: 7 },
      { grade: 'B', description: 'Average', minMark: 50, maxMark: 60, gradePoint: 6 },
      { grade: 'C', description: 'Pass', minMark: 45, maxMark: 49, gradePoint: 5 },
      { grade: 'U', description: 'Re-Appear / Fail', minMark: 0, maxMark: 44, gradePoint: 0 },
      { grade: 'AB', description: 'Absent', minMark: 0, maxMark: 0, gradePoint: 0 }
    ]
  },
  autonomous_10point: {
    systemKey: 'autonomous_10point',
    systemName: 'Autonomous / Standard 10-Point Absolute',
    grades: [
      { grade: 'O', description: 'Outstanding', minMark: 90, maxMark: 100, gradePoint: 10 },
      { grade: 'A+', description: 'Excellent', minMark: 80, maxMark: 89, gradePoint: 9 },
      { grade: 'A', description: 'Very Good', minMark: 70, maxMark: 79, gradePoint: 8 },
      { grade: 'B+', description: 'Good', minMark: 60, maxMark: 69, gradePoint: 7 },
      { grade: 'B', description: 'Above Average', minMark: 50, maxMark: 59, gradePoint: 6 },
      { grade: 'C', description: 'Pass / Satisfactory', minMark: 40, maxMark: 49, gradePoint: 5 },
      { grade: 'RA', description: 'Re-Appear', minMark: 0, maxMark: 39, gradePoint: 0 },
      { grade: 'SA', description: 'Shortage Attendance', minMark: 0, maxMark: 0, gradePoint: 0 },
      { grade: 'W', description: 'Withdrawal', minMark: 0, maxMark: 0, gradePoint: 0 }
    ]
  }
};

const ensureDefaultGradingSystems = async () => {
  try {
    const count = await GradingSystem.countDocuments();
    if (count === 0) {
      await GradingSystem.create([
        {
          name: 'Anna University R2021 (10-Point Letter Grade)',
          code: 'AU_R2021',
          description: 'Standard 10-point letter grading system followed by Anna University (Regulation 2021)',
          isDefault: true,
          grades: DEFAULT_GRADING_SYSTEMS.anna_univ_r2021.grades
        },
        {
          name: 'Autonomous / Standard 10-Point Absolute',
          code: 'AUTO_10PT',
          description: 'Autonomous College 10-point absolute grading with RA/SA/W grade designations',
          isDefault: false,
          grades: DEFAULT_GRADING_SYSTEMS.autonomous_10point.grades
        }
      ]);
    }
  } catch (err) {
    console.error('Error auto-seeding grading systems:', err.message);
  }
};

// ============ GRADING SYSTEMS MANAGEMENT ============
router.get('/grading-systems', async (req, res) => {
  try {
    await ensureDefaultGradingSystems();
    const systems = await GradingSystem.find().sort({ isDefault: -1, createdAt: 1 });
    res.json(systems);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/grading-systems', adminOnly, async (req, res) => {
  try {
    const { name, code, description, grades, isDefault } = req.body;
    if (!name || !code || !Array.isArray(grades) || grades.length === 0) {
      return res.status(400).json({ message: 'Name, code, and at least one grade row are required' });
    }
    if (isDefault) {
      await GradingSystem.updateMany({}, { isDefault: false });
    }
    const newSys = new GradingSystem({
      name: name.trim(),
      code: code.toUpperCase().trim(),
      description: description || '',
      grades,
      isDefault: Boolean(isDefault),
      createdBy: req.session.userId
    });
    await newSys.save();
    res.status(201).json(newSys);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/grading-systems/:id', adminOnly, async (req, res) => {
  try {
    const { name, code, description, grades, isDefault } = req.body;
    if (isDefault) {
      await GradingSystem.updateMany({ _id: { $ne: req.params.id } }, { isDefault: false });
    }
    const updated = await GradingSystem.findByIdAndUpdate(
      req.params.id,
      {
        name: name ? name.trim() : undefined,
        code: code ? code.toUpperCase().trim() : undefined,
        description,
        grades,
        isDefault: Boolean(isDefault)
      },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Grading system not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/grading-systems/:id', adminOnly, async (req, res) => {
  try {
    const count = await GradingSystem.countDocuments();
    if (count <= 1) {
      return res.status(400).json({ message: 'At least one default grading system must be kept in the system' });
    }
    const deleted = await GradingSystem.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Grading system not found' });
    res.json({ message: 'Grading system deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/grading-systems/defaults', (req, res) => {
  res.json(DEFAULT_GRADING_SYSTEMS);
});

router.put('/courses/:id/grading-system', adminOnly, async (req, res) => {
  try {
    const { gradingSystem } = req.body;
    if (!gradingSystem || !Array.isArray(gradingSystem.grades)) {
      return res.status(400).json({ message: 'gradingSystem with grades array is required' });
    }
    const course = await Course.findByIdAndUpdate(
      req.params.id,
      { gradingSystem },
      { new: true }
    ).populate('department', 'name code').populate('faculty', 'name email');
    if (!course) return res.status(404).json({ message: 'Course not found' });
    res.json({ success: true, course });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ ALL ATTAINMENT VIEW ============
router.get('/attainments', adminOnly, async (req, res) => {
  try {
    const attainments = await Attainment.find()
      .populate({ path: 'course', populate: [{ path: 'department', select: 'name code' }, { path: 'faculty', select: 'name' }] })
      .sort({ updatedAt: -1 });
    res.json(attainments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ BULK STUDENT UPLOAD ============
router.post('/students/bulk', adminOnly, async (req, res) => {
  try {
    const { students } = req.body; // array of student objects
    const results = { created: 0, skipped: 0, errors: [] };
    for (const s of students) {
      try {
        const existing = await User.findOne({ email: s.email });
        if (existing) { results.skipped++; continue; }
        const user = new User({ ...s, role: 'student' });
        await user.save();
        results.created++;
      } catch (e) {
        results.errors.push({ email: s.email, error: e.message });
      }
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ ATTAINMENT TEMPLATES (REGULATIONS - A TO Z CUSTOMIZABLE) ============
router.get('/templates', adminOnly, async (req, res) => {
  try {
    let templates = await AttainmentTemplate.find().sort({ createdAt: -1 });
    if (templates.length === 0) {
      // Seed initial default university regulations
      const seedTemplates = [
        {
          name: 'Regulation 2021 (Anna University R2021)',
          code: 'R2021',
          description: 'Standard Anna University 2021 regulation: 80% Direct + 20% Indirect, 40% Internal + 60% EndSem.',
          directWeight: 80,
          indirectWeight: 20,
          internalWeight: 40,
          endSemWeight: 60,
          thresholdScorePercent: 60,
          level3Threshold: 80,
          level2Threshold: 70,
          level1Threshold: 60,
          isDefault: true
        },
        {
          name: 'Autonomous Regulation R2022',
          code: 'R2022',
          description: 'Autonomous College Regulation 2022: 80% Direct + 20% Indirect, 50% Internal + 50% EndSem.',
          directWeight: 80,
          indirectWeight: 20,
          internalWeight: 50,
          endSemWeight: 50,
          thresholdScorePercent: 60,
          level3Threshold: 75,
          level2Threshold: 65,
          level1Threshold: 55,
          isDefault: false
        },
        {
          name: 'Regulation 2017 (Anna University R2017)',
          code: 'R2017',
          description: 'Anna University 2017 regulation: 80% Direct + 20% Indirect, 20% Internal + 80% EndSem.',
          directWeight: 80,
          indirectWeight: 20,
          internalWeight: 20,
          endSemWeight: 80,
          thresholdScorePercent: 50,
          level3Threshold: 70,
          level2Threshold: 60,
          level1Threshold: 50,
          isDefault: false
        }
      ];
      templates = await AttainmentTemplate.insertMany(seedTemplates);
    }
    res.json(templates);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/templates', adminOnly, async (req, res) => {
  try {
    const template = new AttainmentTemplate({ ...req.body, createdBy: req.session.userId });
    await template.save();
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/templates/:id', adminOnly, async (req, res) => {
  try {
    const template = await AttainmentTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/templates/:id', adminOnly, async (req, res) => {
  try {
    await AttainmentTemplate.findByIdAndDelete(req.params.id);
    res.json({ message: 'Template deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ BATCHES & 8-SEM CURRICULUM ============
router.get('/batches', adminOnly, async (req, res) => {
  try {
    const filter = { isActive: { $ne: false } };
    if (req.query.department) filter.department = req.query.department;
    let batches = await Batch.find(filter)
      .populate('department', 'name code')
      .populate('regulation', 'name code')
      .sort({ name: -1 });

    if (batches.length === 0) {
      const dept = await Department.findOne({ isActive: true });
      const reg = await AttainmentTemplate.findOne({ isDefault: true });
      if (dept) {
        await Batch.create([
          { name: '2021-2025', department: dept._id, regulation: reg?._id, startYear: 2021, endYear: 2025, currentSemester: 8, academicYear: '2024-2025', isActive: true },
          { name: '2022-2026', department: dept._id, regulation: reg?._id, startYear: 2022, endYear: 2026, currentSemester: 6, academicYear: '2024-2025', isActive: true },
          { name: '2025-2029', department: dept._id, regulation: reg?._id, startYear: 2025, endYear: 2029, currentSemester: 1, academicYear: '2024-2025', isActive: true }
        ]);
        batches = await Batch.find(filter)
          .populate('department', 'name code')
          .populate('regulation', 'name code')
          .sort({ name: -1 });
      }
    }
    res.json(batches);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/batches', adminOnly, async (req, res) => {
  try {
    const { name, department, regulation, startYear, endYear, currentSemester, academicYear } = req.body;
    let batch = await Batch.findOne({ name, department });
    if (batch) {
      // Update existing batch configuration gracefully
      if (regulation) batch.regulation = regulation;
      if (startYear) batch.startYear = startYear;
      if (endYear) batch.endYear = endYear;
      if (currentSemester) batch.currentSemester = currentSemester;
      if (academicYear) batch.academicYear = academicYear;
      batch.isActive = true;
      await batch.save();
    } else {
      batch = new Batch({ name, department, regulation, startYear, endYear, currentSemester, academicYear, isActive: true });
      await batch.save();
    }
    const saved = await Batch.findById(batch._id).populate('department', 'name code').populate('regulation', 'name code');
    res.status(200).json(saved);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put('/batches/:id', adminOnly, async (req, res) => {
  try {
    const batch = await Batch.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('department', 'name code')
      .populate('regulation', 'name code');
    if (!batch) return res.status(404).json({ message: 'Batch not found' });
    res.json(batch);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete('/batches/:id', adminOnly, async (req, res) => {
  try {
    await Batch.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Batch archived' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ ONE-TIME BATCH STUDENT ROSTER & SEMESTER MANAGEMENT ============
router.get('/batches/:batchName/students', adminOnly, async (req, res) => {
  try {
    const filter = { role: 'student', batch: req.params.batchName, isActive: true };
    if (req.query.department) filter.department = req.query.department;
    if (req.query.semester) {
      filter.excludedSemesters = { $ne: Number(req.query.semester) };
    }
    const students = await User.find(filter)
      .select('name rollNumber email section department semester batch excludedSemesters enrolledSemesters')
      .sort({ rollNumber: 1 });
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post('/batches/:batchName/students', adminOnly, async (req, res) => {
  try {
    const { students, department } = req.body; // array of { name, rollNumber, email, section }
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ message: 'Students array required' });
    }
    const batchName = req.params.batchName;
    const hash = await bcrypt.hash('student123', 10);
    const results = { created: 0, updated: 0, errors: [] };

    for (const s of students) {
      try {
        const email = (s.email || `${s.rollNumber}@college.edu`).toLowerCase().trim();
        const existing = await User.findOne({ email });
        if (existing) {
          existing.batch = batchName;
          existing.rollNumber = s.rollNumber || existing.rollNumber;
          existing.name = s.name || existing.name;
          existing.section = s.section || existing.section || 'A';
          if (department) existing.department = department;
          await existing.save();
          results.updated++;
        } else {
          await User.create({
            name: s.name,
            rollNumber: s.rollNumber,
            email,
            password: hash,
            role: 'student',
            department,
            batch: batchName,
            semester: 1,
            section: s.section || 'A',
            excludedSemesters: [],
            enrolledSemesters: [1, 2, 3, 4, 5, 6, 7, 8],
            isActive: true
          });
          results.created++;
        }
      } catch (err) {
        results.errors.push({ rollNumber: s.rollNumber, error: err.message });
      }
    }
    res.json(results);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add single student to batch (e.g. Lateral Entry joining in Sem 3)
router.post('/batches/:batchName/students/add-single', adminOnly, async (req, res) => {
  try {
    const { name, rollNumber, email, section, department, startSem, excludedSemesters } = req.body;
    if (!name || !rollNumber) {
      return res.status(400).json({ message: 'Student Name and Roll Number are required' });
    }
    const batchName = req.params.batchName;
    const finalEmail = (email || `${rollNumber}@college.edu`).toLowerCase().trim();
    
    // If lateral entry starting at e.g. Sem 3, exclude Sem 1 and 2
    let finalExcluded = Array.isArray(excludedSemesters) ? excludedSemesters : [];
    if (startSem && Number(startSem) > 1) {
      for (let s = 1; s < Number(startSem); s++) {
        if (!finalExcluded.includes(s)) finalExcluded.push(s);
      }
    }

    const existing = await User.findOne({ email: finalEmail });
    if (existing) {
      existing.name = name;
      existing.rollNumber = rollNumber;
      existing.batch = batchName;
      existing.section = section || 'A';
      if (department) existing.department = department;
      existing.excludedSemesters = finalExcluded;
      existing.isActive = true;
      await existing.save();
      return res.json({ message: 'Student updated in batch', student: existing });
    }

    const hash = await bcrypt.hash('student123', 10);
    const newStudent = await User.create({
      name,
      rollNumber,
      email: finalEmail,
      password: hash,
      role: 'student',
      department,
      batch: batchName,
      semester: startSem ? Number(startSem) : 1,
      section: section || 'A',
      excludedSemesters: finalExcluded,
      isActive: true
    });
    res.status(201).json({ message: 'Student created and enrolled', student: newStudent });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update student details or semester enrollments
router.put('/batches/:batchName/students/:studentId', adminOnly, async (req, res) => {
  try {
    const { name, rollNumber, email, section, excludedSemesters, isActive } = req.body;
    const student = await User.findById(req.params.studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    if (name) student.name = name;
    if (rollNumber) student.rollNumber = rollNumber;
    if (email) student.email = email.toLowerCase().trim();
    if (section) student.section = section;
    if (Array.isArray(excludedSemesters)) student.excludedSemesters = excludedSemesters;
    if (isActive !== undefined) student.isActive = isActive;

    await student.save();
    res.json({ message: 'Student updated successfully', student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Toggle a semester exclusion for a student (e.g. remove from Sem 3 or restore to Sem 3)
router.post('/batches/:batchName/students/:studentId/toggle-semester', adminOnly, async (req, res) => {
  try {
    const { semester, action } = req.body;
    const semNum = Number(semester);
    if (!semNum || semNum < 1 || semNum > 8) {
      return res.status(400).json({ message: 'Valid semester number (1-8) required' });
    }

    const student = await User.findById(req.params.studentId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    let excluded = Array.isArray(student.excludedSemesters) ? [...student.excludedSemesters] : [];
    if (action === 'exclude') {
      if (!excluded.includes(semNum)) excluded.push(semNum);
    } else if (action === 'include') {
      excluded = excluded.filter(s => s !== semNum);
    } else {
      // Toggle
      if (excluded.includes(semNum)) {
        excluded = excluded.filter(s => s !== semNum);
      } else {
        excluded.push(semNum);
      }
    }

    student.excludedSemesters = excluded;
    await student.save();
    res.json({
      message: excluded.includes(semNum) ? `Student removed from Semester ${semNum}` : `Student restored to Semester ${semNum}`,
      student
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete student from batch
router.delete('/batches/:batchName/students/:studentId', adminOnly, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.studentId, { isActive: false });
    res.json({ message: 'Student removed from batch successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ EXCEL PARSING & TEMPLATE DOWNLOAD ============
router.post('/parse-excel', adminOnly, async (req, res) => {
  try {
    const { base64File } = req.body;
    if (!base64File) return res.status(400).json({ message: 'Excel file data is required' });

    // Clean base64 string if it contains data URL header
    const cleanBase64 = String(base64File).replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const students = [];
    let parsed = false;

    // 1. Try ExcelJS xlsx load
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];
      if (worksheet) {
        let rollCol = -1, nameCol = -1, emailCol = -1, secCol = -1, headerRowIndex = -1;

        worksheet.eachRow((row, rowNumber) => {
          const values = row.values;
          if (headerRowIndex === -1 && rowNumber <= 10) {
            for (let i = 1; i < values.length; i++) {
              const val = String(values[i] || '').trim().toLowerCase();
              if (/email|mail/.test(val)) emailCol = i;
              else if (/roll|reg|register|htno|hallticket|student\s*id/.test(val)) rollCol = i;
              else if (/name|student\s*name/.test(val) && !/father|college|dept/.test(val)) nameCol = i;
              else if (/sec|section/.test(val)) secCol = i;
            }
            if (rollCol !== -1 && nameCol !== -1) {
              headerRowIndex = rowNumber;
              return;
            }
          }

          if (headerRowIndex !== -1 && rowNumber > headerRowIndex) {
            const rollNumber = String(values[rollCol] || '').trim();
            const name = String(values[nameCol] || '').trim();
            if (rollNumber && name && !/total|average/i.test(name)) {
              const email = emailCol !== -1 ? String(values[emailCol] || '').trim() : '';
              const section = secCol !== -1 ? String(values[secCol] || '').trim() : 'A';
              students.push({
                rollNumber,
                name,
                email: email || `${rollNumber}@college.edu`,
                section: section || 'A'
              });
            }
          }
        });

        // Fallback for sheet without matching headers
        if (students.length === 0) {
          worksheet.eachRow((row) => {
            const rowVals = [];
            row.eachCell((cell) => {
              rowVals.push(String(cell.value || '').trim());
            });
            if (rowVals.length >= 2) {
              const c0 = rowVals[0];
              const c1 = rowVals[1];
              const c2 = rowVals[2];
              if (/^\d{1,4}$/.test(c0) && c1 && c2) {
                students.push({ rollNumber: c1, name: c2, email: `${c1}@college.edu`, section: 'A' });
              } else if (c0 && c1 && !/s\.?no|serial/i.test(c0) && !/reg|roll|name/i.test(c0)) {
                students.push({ rollNumber: c0, name: c1, email: `${c0}@college.edu`, section: 'A' });
              }
            }
          });
        }
        parsed = students.length > 0;
      }
    } catch (xlsxErr) {
      // XLSX parsing failed; fallback to CSV/text
    }

    // 2. If XLSX produced no students, try CSV / text parsing
    if (!parsed || students.length === 0) {
      const text = buffer.toString('utf-8');
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let rollCol = -1, nameCol = -1, emailCol = -1, secCol = -1, headerFound = false;

      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(/[,\t]+/).map(p => p.trim().replace(/^["']|["']$/g, ''));
        if (!headerFound && i <= 5) {
          for (let j = 0; j < parts.length; j++) {
            const val = parts[j].toLowerCase();
            if (/email|mail/.test(val)) emailCol = j;
            else if (/roll|reg|register|htno|student\s*id/.test(val)) rollCol = j;
            else if (/name|student\s*name/.test(val)) nameCol = j;
            else if (/sec|section/.test(val)) secCol = j;
          }
          if (rollCol !== -1 && nameCol !== -1) {
            headerFound = true;
            continue;
          }
        }

        if (headerFound) {
          const rollNumber = parts[rollCol] || '';
          const name = parts[nameCol] || '';
          if (rollNumber && name) {
            students.push({
              rollNumber,
              name,
              email: emailCol !== -1 && parts[emailCol] ? parts[emailCol] : `${rollNumber}@college.edu`,
              section: secCol !== -1 && parts[secCol] ? parts[secCol] : 'A'
            });
          }
        } else if (parts.length >= 2) {
          if (!/s\.?no|serial|roll|reg|name/i.test(parts[0])) {
            students.push({
              rollNumber: parts[0],
              name: parts[1],
              email: parts[2] || `${parts[0]}@college.edu`,
              section: parts[3] || 'A'
            });
          }
        }
      }
    }

    if (students.length === 0) {
      return res.status(400).json({ message: 'No student rows detected. Ensure Excel columns include Register Number and Student Name.' });
    }

    res.json({ success: true, count: students.length, students });
  } catch (error) {
    res.status(500).json({ message: 'Failed to parse file: ' + error.message });
  }
});

router.get('/template/student-roster', adminOnly, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Students Roster');
    worksheet.columns = [
      { header: 'Register Number', key: 'rollNumber', width: 22 },
      { header: 'Student Name', key: 'name', width: 28 },
      { header: 'Email ID', key: 'email', width: 30 },
      { header: 'Section', key: 'section', width: 12 }
    ];
    worksheet.addRow({ rollNumber: '7376221CS101', name: 'Arun Kumar', email: 'arun@college.edu', section: 'A' });
    worksheet.addRow({ rollNumber: '7376221CS102', name: 'Bala Murugan', email: 'bala@college.edu', section: 'A' });
    worksheet.addRow({ rollNumber: '7376221CS103', name: 'Divya S', email: 'divya@college.edu', section: 'B' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=student_roster_template.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

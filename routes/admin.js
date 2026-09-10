const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Department = require('../models/Department');
const Course = require('../models/Course');
const Attainment = require('../models/Attainment');
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
    const courses = await Course.find({ isActive: true })
      .populate('department', 'name code')
      .populate('faculty', 'name email')
      .sort({ createdAt: -1 });
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

module.exports = router;

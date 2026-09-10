const express = require('express');
const router = express.Router();
const Marks = require('../models/Marks');
const Attainment = require('../models/Attainment');
const Course = require('../models/Course');
const User = require('../models/User');
const { requireAuth } = require('./auth');

const studentOnly = requireAuth(['student']);

// ============ MY COURSES ============
router.get('/courses', studentOnly, async (req, res) => {
  try {
    const student = await User.findById(req.session.userId);
    const courses = await Course.find({
      department: student.department,
      semester: student.semester,
      batch: student.batch,
      isActive: true
    }).populate('faculty', 'name').sort({ name: 1 });
    res.json(courses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ MY MARKS ============
router.get('/marks', studentOnly, async (req, res) => {
  try {
    const { courseId } = req.query;
    const filter = { student: req.session.userId };
    if (courseId) filter.course = courseId;
    const marks = await Marks.find(filter)
      .populate('course', 'name code semester');
    res.json(marks);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ MY ATTAINMENT ============
router.get('/attainment/:courseId', studentOnly, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });

    const courseAttainment = await Attainment.findOne({ course: req.params.courseId })
      .populate('course', 'name code');
    if (!courseAttainment) {
      return res.status(404).json({ message: 'Attainment not calculated yet for this course' });
    }

    // Get student's own marks
    const marks = await Marks.find({
      student: req.session.userId,
      course: req.params.courseId
    });

    res.json({
      courseAttainment,
      myMarks: marks
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============ PROFILE ============
router.get('/profile', studentOnly, async (req, res) => {
  try {
    const student = await User.findById(req.session.userId)
      .select('-password')
      .populate('department', 'name code');
    res.json(student);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

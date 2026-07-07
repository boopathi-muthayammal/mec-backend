const express = require('express');
const bcrypt = require('bcryptjs');
const { Admin, Student } = require('../database');

const router = express.Router();

// POST /api/auth/admin-login
router.post('/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const admin = await Admin.findOne({ username });

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    req.session.admin = { id: admin.id, username: admin.username };
    req.session.student = null;

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ success: false, message: 'Server error during login' });
      }
      res.json({ success: true, message: 'Login successful' });
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// POST /api/auth/student-login — Roll Number + DOB
router.post('/student-login', async (req, res) => {
  try {
    const { roll_number, dob } = req.body;

    if (!roll_number || !dob) {
      return res.status(400).json({ success: false, message: 'Roll Number and Date of Birth are required' });
    }

    const student = await Student.findOne({ roll_number: roll_number.trim().toUpperCase() });

    if (!student) {
      return res.status(401).json({ success: false, message: 'Invalid Roll Number or Date of Birth' });
    }

    // Compare DOB (stored as YYYY-MM-DD or DD-MM-YYYY)
    // Normalize both to compare
    const inputDob = normalizeDob(dob);
    const storedDob = normalizeDob(student.dob);

    if (inputDob !== storedDob) {
      return res.status(401).json({ success: false, message: 'Invalid Roll Number or Date of Birth' });
    }

    req.session.student = {
      id: student.id,
      name: student.name,
      roll_number: student.roll_number,
      year: student.year,
      section: student.section
    };
    req.session.admin = null;

    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.status(500).json({ success: false, message: 'Server error during login' });
      }
      res.json({
        success: true,
        message: 'Login successful',
        student: {
          name: student.name,
          roll_number: student.roll_number,
          year: student.year,
          section: student.section
        }
      });
    });
  } catch (error) {
    console.error('Student login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// Normalize DOB to YYYY-MM-DD format for comparison
function normalizeDob(dob) {
  if (!dob) return '';
  
  let cleaned = '';
  if (dob instanceof Date) {
    const year = dob.getFullYear();
    const month = String(dob.getMonth() + 1).padStart(2, '0');
    const day = String(dob.getDate()).padStart(2, '0');
    cleaned = `${year}-${month}-${day}`;
  } else {
    cleaned = String(dob).trim();
  }

  if (!cleaned) return '';
  
  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }
  
  // DD-MM-YYYY or DD/MM/YYYY
  if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(cleaned)) {
    const parts = cleaned.split(/[-\/]/);
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }

  // MM/DD/YYYY (US format)
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cleaned)) {
    const parts = cleaned.split('/');
    return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  }

  // Handle ISO string format (e.g. 2005-05-15T00:00:00.000Z)
  if (cleaned.includes('T')) {
    const datePart = cleaned.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return datePart;
    }
  }

  return cleaned;
}

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  try {
    req.session.destroy((err) => {
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).json({ success: false, message: 'Error during logout' });
      }
      res.clearCookie('connect.sid');
      res.json({ success: true, message: 'Logged out successfully' });
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Server error during logout' });
  }
});

// GET /api/auth/check-session
router.get('/check-session', (req, res) => {
  try {
    if (req.session.admin) {
      return res.json({ success: true, role: 'admin', user: req.session.admin });
    }
    if (req.session.student) {
      return res.json({ success: true, role: 'student', user: req.session.student });
    }
    res.json({ success: true, role: 'none', user: null });
  } catch (error) {
    console.error('Check session error:', error);
    res.status(500).json({ success: false, message: 'Server error checking session' });
  }
});

module.exports = router;

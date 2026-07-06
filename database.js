const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const dbPath = path.join(__dirname, 'exam_portal.db');

// Schema options to virtualize 'id' corresponding to '_id' for compatibility
const schemaOptions = {
  toJSON: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
};

// 1. Admin Schema
const adminSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
}, schemaOptions);

// 2. Student Schema
const studentSchema = new mongoose.Schema({
  roll_number: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  dob: { type: String, required: true },
  year: { type: Number, required: true },
  section: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
}, schemaOptions);

// 3. Exam Schema
const examSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  duration_minutes: { type: Number, required: true, default: 30 },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  created_at: { type: Date, default: Date.now },
  is_active: { type: Boolean, default: true },
  target_years: { type: [Number], default: [1, 2, 3, 4] },
  target_sections: { type: [String], default: ['A', 'B', 'C', 'D', 'E'] }
}, schemaOptions);

// 4. Question Schema
const questionSchema = new mongoose.Schema({
  exam_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  question_type: { type: String, enum: ['MCQ', 'PROGRAM'], default: 'MCQ', required: true },
  question_text: { type: String, required: true },
  option_a: { type: String },
  option_b: { type: String },
  option_c: { type: String },
  option_d: { type: String },
  correct_option: { type: String }, // A, B, C, or D for MCQ
  marks: { type: Number, required: true, default: 1 },
  test_cases: [{
    input: { type: String, default: '' },
    expected_output: { type: String, required: true },
    is_public: { type: Boolean, default: true }
  }]
}, schemaOptions);

// 5. Answer Schema
const answerSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  exam_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  question_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  answer_text: { type: String },
  language: { type: String, default: null },
  submitted_at: { type: Date, default: Date.now }
}, schemaOptions);

// 6. Result Schema
const resultSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  exam_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
  mcq_score: { type: Number, required: true, default: 0 },
  mcq_total: { type: Number, required: true, default: 0 },
  program_score: { type: Number, default: 0 },
  program_total: { type: Number, default: 0 },
  program_submitted: { type: Boolean, default: false },
  tab_switches: { type: Number, default: 0 },
  auto_submitted: { type: Boolean, default: false },
  submitted_at: { type: Date, default: Date.now }
}, schemaOptions);

const Admin = mongoose.model('Admin', adminSchema);
const Student = mongoose.model('Student', studentSchema);
const Exam = mongoose.model('Exam', examSchema);
const Question = mongoose.model('Question', questionSchema);
const Answer = mongoose.model('Answer', answerSchema);
const Result = mongoose.model('Result', resultSchema);

async function initDatabase() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://boopathicsemec_db_user:Boopathi1431@cluster0.ij6pfwd.mongodb.net/?appName=Cluster0';
  
  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB successfully via Mongoose.');

  // SQLite-to-MongoDB Migration check
  if (fs.existsSync(dbPath)) {
    console.log('SQLite database file (exam_portal.db) detected. Starting automatic migration to MongoDB...');
    try {
      const SQL = await initSqlJs();
      const fileBuffer = fs.readFileSync(dbPath);
      const sqliteDb = new SQL.Database(fileBuffer);

      // Helper function to read SQLite table
      function getSqliteRows(tableName) {
        try {
          const stmt = sqliteDb.prepare(`SELECT * FROM ${tableName}`);
          const results = [];
          const cols = stmt.getColumnNames();
          while (stmt.step()) {
            const values = stmt.get();
            const obj = {};
            cols.forEach((c, i) => obj[c] = values[i]);
            results.push(obj);
          }
          stmt.free();
          return results;
        } catch (err) {
          console.log(`Table ${tableName} read error:`, err.message);
          return [];
        }
      }

      // 1. Migrate Admins
      const sqliteAdmins = getSqliteRows('admins');
      const adminIdMap = {}; // SQLite ID -> MongoDB ObjectId
      for (const sqliteAdmin of sqliteAdmins) {
        let admin = await Admin.findOne({ username: sqliteAdmin.username });
        if (!admin) {
          admin = await Admin.create({
            username: sqliteAdmin.username,
            password: sqliteAdmin.password
          });
          console.log(`Migrated admin: ${admin.username}`);
        }
        adminIdMap[sqliteAdmin.id] = admin._id;
      }

      // 2. Migrate Students
      const sqliteStudents = getSqliteRows('students');
      const studentIdMap = {}; // SQLite ID -> MongoDB ObjectId
      for (const sqliteStudent of sqliteStudents) {
        let student = await Student.findOne({ roll_number: sqliteStudent.roll_number });
        if (!student) {
          student = await Student.create({
            roll_number: sqliteStudent.roll_number,
            name: sqliteStudent.name,
            dob: sqliteStudent.dob,
            year: sqliteStudent.year,
            section: sqliteStudent.section,
            created_at: sqliteStudent.created_at ? new Date(sqliteStudent.created_at) : new Date()
          });
          console.log(`Migrated student: ${student.roll_number}`);
        }
        studentIdMap[sqliteStudent.id] = student._id;
      }

      // 3. Migrate Exams
      const sqliteExams = getSqliteRows('exams');
      const examIdMap = {}; // SQLite ID -> MongoDB ObjectId
      for (const sqliteExam of sqliteExams) {
        const createdByMongoId = adminIdMap[sqliteExam.created_by] || null;
        const exam = await Exam.create({
          title: sqliteExam.title,
          description: sqliteExam.description,
          duration_minutes: sqliteExam.duration_minutes,
          created_by: createdByMongoId,
          created_at: sqliteExam.created_at ? new Date(sqliteExam.created_at) : new Date(),
          is_active: sqliteExam.is_active === 1
        });
        examIdMap[sqliteExam.id] = exam._id;
        console.log(`Migrated exam: ${exam.title}`);
      }

      // 4. Migrate Questions
      const sqliteQuestions = getSqliteRows('questions');
      const questionIdMap = {}; // SQLite ID -> MongoDB ObjectId
      for (const sqliteQuestion of sqliteQuestions) {
        const examMongoId = examIdMap[sqliteQuestion.exam_id];
        if (examMongoId) {
          const question = await Question.create({
            exam_id: examMongoId,
            question_type: sqliteQuestion.question_type,
            question_text: sqliteQuestion.question_text,
            option_a: sqliteQuestion.option_a,
            option_b: sqliteQuestion.option_b,
            option_c: sqliteQuestion.option_c,
            option_d: sqliteQuestion.option_d,
            correct_option: sqliteQuestion.correct_option,
            marks: sqliteQuestion.marks
          });
          questionIdMap[sqliteQuestion.id] = question._id;
        }
      }
      console.log(`Migrated ${Object.keys(questionIdMap).length} questions.`);

      // 5. Migrate Answers
      const sqliteAnswers = getSqliteRows('answers');
      let answerCount = 0;
      for (const sqliteAnswer of sqliteAnswers) {
        const studentMongoId = studentIdMap[sqliteAnswer.student_id];
        const examMongoId = examIdMap[sqliteAnswer.exam_id];
        const questionMongoId = questionIdMap[sqliteAnswer.question_id];
        if (studentMongoId && examMongoId && questionMongoId) {
          await Answer.create({
            student_id: studentMongoId,
            exam_id: examMongoId,
            question_id: questionMongoId,
            answer_text: sqliteAnswer.answer_text,
            submitted_at: sqliteAnswer.submitted_at ? new Date(sqliteAnswer.submitted_at) : new Date()
          });
          answerCount++;
        }
      }
      console.log(`Migrated ${answerCount} student answers.`);

      // 6. Migrate Results
      const sqliteResults = getSqliteRows('results');
      let resultCount = 0;
      for (const sqliteResult of sqliteResults) {
        const studentMongoId = studentIdMap[sqliteResult.student_id];
        const examMongoId = examIdMap[sqliteResult.exam_id];
        if (studentMongoId && examMongoId) {
          await Result.create({
            student_id: studentMongoId,
            exam_id: examMongoId,
            mcq_score: sqliteResult.mcq_score,
            mcq_total: sqliteResult.mcq_total,
            program_submitted: sqliteResult.program_submitted === 1,
            tab_switches: sqliteResult.tab_switches,
            auto_submitted: sqliteResult.auto_submitted === 1,
            submitted_at: sqliteResult.submitted_at ? new Date(sqliteResult.submitted_at) : new Date()
          });
          resultCount++;
        }
      }
      console.log(`Migrated ${resultCount} exam results.`);

      sqliteDb.close();

      // Rename SQLite file so migration won't run again
      const backupPath = dbPath + '.bak';
      fs.renameSync(dbPath, backupPath);
      console.log(`SQLite database successfully migrated and renamed to ${path.basename(backupPath)}`);

    } catch (migrationErr) {
      console.error('Error during SQLite to MongoDB migration:', migrationErr);
    }
  }

  // Ensure default admin exists
  const existingAdmin = await Admin.findOne({ username: 'boopathi.mec.cse@gmail.com' });
  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync('Boopathi@1431', 10);
    await Admin.create({
      username: 'boopathi.mec.cse@gmail.com',
      password: hashedPassword
    });
    console.log('Default admin seeded: username=boopathi.mec.cse@gmail.com');
  }
}

module.exports = {
  initDatabase,
  Admin,
  Student,
  Exam,
  Question,
  Answer,
  Result
};

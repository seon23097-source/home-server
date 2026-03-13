// routes/evaluations.js — school_year 연도별 필터링 추가

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

// ────────────────────────────────────────────────────────────
// GET /api/evaluations/category/:categoryId?year=2026
// ────────────────────────────────────────────────────────────
router.get('/category/:categoryId', auth, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);
    const { rows } = await pool.query(
      `SELECT e.*
       FROM   evaluation_records e
       JOIN   students s ON s.id = e.student_id
       WHERE  s.teacher_id    = $1
         AND  e.category_id   = $2
         AND  e.school_year   = $3
       ORDER  BY e.evaluation_date DESC`,
      [req.user.id, req.params.categoryId, schoolYear]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /evaluations/category/:id error:', err);
    res.status(500).json({ error: '평가 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/evaluations/student/:studentId?year=2026
// ────────────────────────────────────────────────────────────
router.get('/student/:studentId', auth, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);
    const { rows } = await pool.query(
      `SELECT e.*
       FROM   evaluation_records e
       JOIN   students s ON s.id = e.student_id
       WHERE  s.teacher_id   = $1
         AND  e.student_id   = $2
         AND  e.school_year  = $3
       ORDER  BY e.evaluation_date DESC`,
      [req.user.id, req.params.studentId, schoolYear]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /evaluations/student/:id error:', err);
    res.status(500).json({ error: '평가 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/evaluations?year=2026&studentId=&categoryId=
// ────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const schoolYear  = resolveYear(req.query.year);
    const { studentId, categoryId } = req.query;

    let query = `
      SELECT e.*
      FROM   evaluation_records e
      JOIN   students s ON s.id = e.student_id
      WHERE  s.teacher_id   = $1
        AND  e.school_year  = $2`;
    const params = [req.user.id, schoolYear];

    if (studentId) {
      params.push(studentId);
      query += ` AND e.student_id = $${params.length}`;
    }
    if (categoryId) {
      params.push(categoryId);
      query += ` AND e.category_id = $${params.length}`;
    }

    query += ' ORDER BY e.evaluation_date DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('GET /evaluations error:', err);
    res.status(500).json({ error: '평가 목록 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/evaluations
//   body: { student_id, category_id, score, evaluation_date, title, school_year? }
// ────────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { student_id, category_id, score, evaluation_date, title } = req.body;
    const schoolYear = resolveYear(req.body.school_year);

    const { rows } = await pool.query(
      `INSERT INTO evaluation_records
         (student_id, category_id, score, evaluation_date, title, school_year)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [student_id, category_id, score, evaluation_date, title, schoolYear]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /evaluations error:', err);
    res.status(500).json({ error: '평가 추가 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /api/evaluations/:id
// ────────────────────────────────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  try {
    const { score, title, evaluation_date } = req.body;
    const schoolYear = resolveYear(req.body.school_year);

    const { rows } = await pool.query(
      `UPDATE evaluation_records e
       SET    score           = COALESCE($1, e.score),
              title           = COALESCE($2, e.title),
              evaluation_date = COALESCE($3, e.evaluation_date)
       FROM   students s
       WHERE  e.id          = $4
         AND  e.student_id  = s.id
         AND  s.teacher_id  = $5
         AND  e.school_year = $6
       RETURNING e.*`,
      [score, title, evaluation_date, req.params.id, req.user.id, schoolYear]
    );

    if (!rows.length) return res.status(404).json({ error: '평가를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /evaluations/:id error:', err);
    res.status(500).json({ error: '평가 수정 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /api/evaluations/:id
// ────────────────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);

    const { rowCount } = await pool.query(
      `DELETE FROM evaluation_records e
       USING  students s
       WHERE  e.id         = $1
         AND  e.student_id = s.id
         AND  s.teacher_id = $2
         AND  e.school_year = $3`,
      [req.params.id, req.user.id, schoolYear]
    );

    if (!rowCount) return res.status(404).json({ error: '평가를 찾을 수 없습니다.' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /evaluations/:id error:', err);
    res.status(500).json({ error: '평가 삭제 실패' });
  }
});

function resolveYear(value) {
  if (value) return parseInt(value, 10);
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

module.exports = router;

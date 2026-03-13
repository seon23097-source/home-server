// routes/students.js — school_year 연도별 필터링 추가

const express = require('express');
const router  = express.Router();
const pool    = require('../db');           // 기존 DB 풀 경로 유지
const auth    = require('../middleware/auth'); // 기존 인증 미들웨어 경로 유지

// ────────────────────────────────────────────────────────────
// GET /api/students/count?year=2026
// ────────────────────────────────────────────────────────────
router.get('/count', auth, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);
    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM students
       WHERE teacher_id = $1 AND school_year = $2 AND is_active = true`,
      [req.user.id, schoolYear]
    );
    res.json({ count: parseInt(rows[0].count) });
  } catch (err) {
    console.error('GET /students/count error:', err);
    res.status(500).json({ error: '학생 수 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// GET /api/students?year=2026
//   year 미전달 시 현재 학년도(3월 기준) 자동 계산
// ────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const schoolYear      = resolveYear(req.query.year);
    const includeInactive = req.query.includeInactive === 'true';

    const { rows } = await pool.query(
      `SELECT id, name, student_number, is_active, school_year, created_at, deactivated_at
       FROM   students
       WHERE  teacher_id  = $1
         AND  school_year = $2
         ${includeInactive ? '' : 'AND is_active = true'}
       ORDER  BY student_number ASC`,
      [req.user.id, schoolYear]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /students error:', err);
    res.status(500).json({ error: '학생 목록 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/students  — 신규 학생 추가
//   body: { name, student_number, school_year? }
// ────────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { name, student_number } = req.body;
    const schoolYear = resolveYear(req.body.school_year);

    if (!name || !student_number) {
      return res.status(400).json({ error: '이름과 번호는 필수입니다.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO students (name, student_number, is_active, teacher_id, school_year)
       VALUES ($1, $2, true, $3, $4)
       RETURNING *`,
      [name, student_number, req.user.id, schoolYear]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /students error:', err);
    res.status(500).json({ error: '학생 추가 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /api/students/:id
// ────────────────────────────────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, student_number, is_active } = req.body;
    const schoolYear = resolveYear(req.body.school_year);

    const { rows } = await pool.query(
      `UPDATE students
       SET    name           = COALESCE($1, name),
              student_number = COALESCE($2, student_number),
              is_active      = COALESCE($3, is_active)
       WHERE  id         = $4
         AND  teacher_id = $5
         AND  school_year = $6
       RETURNING *`,
      [name, student_number, is_active, req.params.id, req.user.id, schoolYear]
    );

    if (!rows.length) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /students/:id error:', err);
    res.status(500).json({ error: '학생 수정 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /api/students/:id
// ────────────────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);

    const { rowCount } = await pool.query(
      `DELETE FROM students
       WHERE  id          = $1
         AND  teacher_id  = $2
         AND  school_year = $3`,
      [req.params.id, req.user.id, schoolYear]
    );

    if (!rowCount) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /students/:id error:', err);
    res.status(500).json({ error: '학생 삭제 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// PATCH /api/students/:id/deactivate  — 전출 처리
// ────────────────────────────────────────────────────────────
router.patch('/:id/deactivate', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE students
       SET    is_active      = false,
              deactivated_at = NOW()
       WHERE  id         = $1
         AND  teacher_id = $2
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /students/:id/deactivate error:', err);
    res.status(500).json({ error: '전출 처리 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// PATCH /api/students/:id/activate  — 전입 복귀
// ────────────────────────────────────────────────────────────
router.patch('/:id/activate', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE students
       SET    is_active      = true,
              deactivated_at = NULL
       WHERE  id         = $1
         AND  teacher_id = $2
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: '학생을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /students/:id/activate error:', err);
    res.status(500).json({ error: '전입 복귀 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// 헬퍼: 학년도 결정 (3월 기준)
//   전달된 값이 있으면 그대로, 없으면 현재 날짜 기준 학년도 반환
// ────────────────────────────────────────────────────────────
function resolveYear(value) {
  if (value) return parseInt(value, 10);
  const now = new Date();
  // 3월(2) 이상이면 당해 연도, 1~2월이면 전년도가 학년도
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

module.exports = router;

// routes/categories.js — school_year 연도별 필터링 추가

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const auth    = require('../middleware/auth');

// ────────────────────────────────────────────────────────────
// GET /api/categories?year=2026
// ────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);

    const { rows } = await pool.query(
      `SELECT id, name, max_score, teacher_id, school_year
       FROM   evaluation_categories
       WHERE  teacher_id  = $1
         AND  school_year = $2
       ORDER  BY name ASC`,
      [req.user.id, schoolYear]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /categories error:', err);
    res.status(500).json({ error: '카테고리 목록 조회 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// POST /api/categories
//   body: { name, max_score, school_year? }
// ────────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { name, max_score } = req.body;
    const schoolYear = resolveYear(req.body.school_year);

    if (!name) return res.status(400).json({ error: '카테고리 이름은 필수입니다.' });

    const { rows } = await pool.query(
      `INSERT INTO evaluation_categories (name, max_score, teacher_id, school_year)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, max_score || 100, req.user.id, schoolYear]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('POST /categories error:', err);
    res.status(500).json({ error: '카테고리 추가 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// PUT /api/categories/:id
// ────────────────────────────────────────────────────────────
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, max_score } = req.body;
    const schoolYear = resolveYear(req.body.school_year);

    const { rows } = await pool.query(
      `UPDATE evaluation_categories
       SET    name      = COALESCE($1, name),
              max_score = COALESCE($2, max_score)
       WHERE  id         = $3
         AND  teacher_id = $4
         AND  school_year = $5
       RETURNING *`,
      [name, max_score, req.params.id, req.user.id, schoolYear]
    );

    if (!rows.length) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /categories/:id error:', err);
    res.status(500).json({ error: '카테고리 수정 실패' });
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /api/categories/:id
// ────────────────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);

    const { rowCount } = await pool.query(
      `DELETE FROM evaluation_categories
       WHERE  id          = $1
         AND  teacher_id  = $2
         AND  school_year = $3`,
      [req.params.id, req.user.id, schoolYear]
    );

    if (!rowCount) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다.' });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /categories/:id error:', err);
    res.status(500).json({ error: '카테고리 삭제 실패' });
  }
});

function resolveYear(value) {
  if (value) return parseInt(value, 10);
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

module.exports = router;

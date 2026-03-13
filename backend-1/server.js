import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import pool from './db.js';
import { initializeDatabase } from './init-db.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'class-eval-secret-2024';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

initializeDatabase();

// ── 학년도 결정 헬퍼 (3월 기준) ──
function resolveYear(value) {
  if (value) return parseInt(value, 10);
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// ============ JWT 인증 미들웨어 ============
const authenticate = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.teacher = decoded; // { id, username, display_name, is_admin }
    next();
  } catch {
    return res.status(401).json({ error: '인증이 만료되었습니다. 다시 로그인해주세요.' });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.teacher.is_admin) {
    return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  }
  next();
};

// ============ 인증 API ============

// 시스템 초기 설정 확인 (선생님 계정 있는지)
app.get('/api/auth/check', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM teachers');
    res.json({ hasPassword: parseInt(result.rows[0].count) > 0 });
  } catch {
    // teachers 테이블 없으면 구버전
    try {
      const result = await pool.query('SELECT COUNT(*) FROM auth');
      res.json({ hasPassword: parseInt(result.rows[0].count) > 0 });
    } catch {
      res.json({ hasPassword: false });
    }
  }
});

// 최초 관리자 계정 설정 (아무도 없을 때만)
app.post('/api/auth/setup', async (req, res) => {
  try {
    const { password, username, display_name } = req.body;
    const count = await pool.query('SELECT COUNT(*) FROM teachers');
    if (parseInt(count.rows[0].count) > 0) {
      return res.status(400).json({ error: '이미 계정이 설정되어 있습니다.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO teachers (username, password_hash, display_name, is_admin) VALUES ($1, $2, $3, true) RETURNING id, username, display_name, is_admin',
      [username || 'admin', hash, display_name || '관리자']
    );
    const teacher = result.rows[0];
    const token = jwt.sign(teacher, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, teacher });
  } catch (error) {
    console.error('설정 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 로그인
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM teachers WHERE username = $1',
      [username]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const teacher = result.rows[0];
    const isValid = await bcrypt.compare(password, teacher.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const payload = { id: teacher.id, username: teacher.username, display_name: teacher.display_name, is_admin: teacher.is_admin };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, teacher: payload });
  } catch (error) {
    console.error('로그인 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 내 정보 확인
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ teacher: req.teacher });
});

// ============ 선생님 계정 관리 (관리자 전용) ============

// 전체 선생님 목록
app.get('/api/teachers', authenticate, adminOnly, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, display_name, is_admin, created_at FROM teachers ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 선생님 추가 (관리자 전용)
app.post('/api/teachers', authenticate, adminOnly, async (req, res) => {
  try {
    const { username, password, display_name } = req.body;
    if (!username || !password || !display_name) {
      return res.status(400).json({ error: '아이디, 비밀번호, 이름을 모두 입력해주세요.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO teachers (username, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name, is_admin',
      [username, hash, display_name]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 선생님 삭제 (관리자 전용, 본인 제외)
app.delete('/api/teachers/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.teacher.id) {
      return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });
    }
    await pool.query('DELETE FROM teachers WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 비밀번호 변경
app.patch('/api/teachers/password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const result = await pool.query('SELECT password_hash FROM teachers WHERE id = $1', [req.teacher.id]);
    const isValid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE teachers SET password_hash = $1 WHERE id = $2', [hash, req.teacher.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============ 학생 관리 API ============

app.get('/api/students/count', authenticate, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);
    const result = await pool.query(
      'SELECT COUNT(*) FROM students WHERE teacher_id = $1 AND school_year = $2 AND is_active = true',
      [req.teacher.id, schoolYear]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/students', authenticate, async (req, res) => {
  try {
    const { includeInactive } = req.query;
    const schoolYear = resolveYear(req.query.year);
    let query = 'SELECT * FROM students WHERE teacher_id = $1 AND school_year = $2';
    if (includeInactive !== 'true') query += ' AND is_active = true';
    query += ' ORDER BY student_number';
    const result = await pool.query(query, [req.teacher.id, schoolYear]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/students/bulk', authenticate, async (req, res) => {
  try {
    const { students } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const student of students) {
        await client.query(
          'INSERT INTO students (student_number, name, teacher_id, school_year) VALUES ($1, $2, $3, $4)',
          [student.student_number, student.name, req.teacher.id, resolveYear(req.body.school_year)]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true, count: students.length });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('bulk 학생 등록 오류:', error);
    res.status(500).json({ error: error.message || '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/students', authenticate, async (req, res) => {
  try {
    const { student_number, name } = req.body;
    const schoolYear = resolveYear(req.body.school_year);
    const result = await pool.query(
      'INSERT INTO students (student_number, name, teacher_id, school_year) VALUES ($1, $2, $3, $4) RETURNING *',
      [student_number, name, req.teacher.id, schoolYear]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/students/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const result = await pool.query(
      'UPDATE students SET name = $1 WHERE id = $2 AND teacher_id = $3 RETURNING *',
      [name, id, req.teacher.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.patch('/api/students/:id/deactivate', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE students SET is_active = false, deactivated_at = CURRENT_TIMESTAMP WHERE id = $1 AND teacher_id = $2 RETURNING *',
      [id, req.teacher.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.patch('/api/students/:id/activate', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE students SET is_active = true, deactivated_at = NULL WHERE id = $1 AND teacher_id = $2 RETURNING *',
      [id, req.teacher.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============ 평가 카테고리 API ============

app.get('/api/categories', authenticate, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);
    const result = await pool.query(
      'SELECT * FROM evaluation_categories WHERE teacher_id = $1 AND school_year = $2 ORDER BY display_order, id',
      [req.teacher.id, schoolYear]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/categories', authenticate, async (req, res) => {
  try {
    const { name, max_score } = req.body;
    const maxOrderResult = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) as max_order FROM evaluation_categories WHERE teacher_id = $1',
      [req.teacher.id]
    );
    const nextOrder = maxOrderResult.rows[0].max_order + 1;
    const schoolYear = resolveYear(req.body.school_year);
    const result = await pool.query(
      'INSERT INTO evaluation_categories (name, max_score, display_order, teacher_id, school_year) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, max_score, nextOrder, req.teacher.id, schoolYear]
    );
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      res.status(400).json({ error: '이미 존재하는 카테고리 이름입니다.' });
    } else {
      res.status(500).json({ error: '서버 오류가 발생했습니다.' });
    }
  }
});

app.put('/api/categories/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, max_score } = req.body;
    const result = await pool.query(
      'UPDATE evaluation_categories SET name = $1, max_score = $2 WHERE id = $3 AND teacher_id = $4 RETURNING *',
      [name, max_score, id, req.teacher.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/categories/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const checkResult = await pool.query(
      'SELECT COUNT(*) FROM evaluation_records WHERE category_id = $1',
      [id]
    );
    if (parseInt(checkResult.rows[0].count) > 0) {
      return res.status(400).json({ error: '평가 기록이 있는 카테고리는 삭제할 수 없습니다.' });
    }
    await pool.query('DELETE FROM evaluation_categories WHERE id = $1 AND teacher_id = $2', [id, req.teacher.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============ 평가 기록 API ============

app.get('/api/evaluations/category/:categoryId', authenticate, async (req, res) => {
  try {
    const { categoryId } = req.params;
    const schoolYear = resolveYear(req.query.year);
    const result = await pool.query(`
      SELECT er.id, er.student_id, s.student_number, s.name as student_name,
        er.score, er.title, er.evaluation_date, er.created_at
      FROM evaluation_records er
      JOIN students s ON er.student_id = s.id
      WHERE er.category_id = $1 AND s.teacher_id = $2 AND er.school_year = $3
      ORDER BY s.student_number, er.evaluation_date DESC
    `, [categoryId, req.teacher.id, schoolYear]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/evaluations/student/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const schoolYear = resolveYear(req.query.year);
    const result = await pool.query(`
      SELECT er.id, er.category_id, ec.name as category_name, ec.max_score,
        er.score, er.title, er.evaluation_date, er.created_at
      FROM evaluation_records er
      JOIN evaluation_categories ec ON er.category_id = ec.id
      WHERE er.student_id = $1 AND er.school_year = $2
      ORDER BY er.evaluation_date DESC, ec.display_order
    `, [studentId, schoolYear]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/evaluations', authenticate, async (req, res) => {
  try {
    const { student_id, category_id, score, evaluation_date, title } = req.body;
    const schoolYear = resolveYear(req.body.school_year);
    const result = await pool.query(
      'INSERT INTO evaluation_records (student_id, category_id, score, evaluation_date, title, school_year) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [student_id, category_id, score, evaluation_date || new Date().toISOString().split('T')[0], title || '', schoolYear]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.put('/api/evaluations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { score, evaluation_date, title } = req.body;
    const result = await pool.query(
      'UPDATE evaluation_records SET score = $1, evaluation_date = $2, title = $3 WHERE id = $4 RETURNING *',
      [score, evaluation_date, title || '', id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/evaluations/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM evaluation_records WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============ 체크리스트 API ============

// 체크리스트 주제 목록 조회
app.get('/api/checklist/topics', authenticate, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);
    const result = await pool.query(
      'SELECT * FROM checklist_topics WHERE teacher_id = $1 AND school_year = $2 ORDER BY display_order, id',
      [req.teacher.id, schoolYear]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 주제 생성
app.post('/api/checklist/topics', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    const schoolYear = resolveYear(req.body.school_year);
    const maxOrderResult = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) as max_order FROM checklist_topics WHERE teacher_id = $1',
      [req.teacher.id]
    );
    const nextOrder = maxOrderResult.rows[0].max_order + 1;
    const result = await pool.query(
      'INSERT INTO checklist_topics (name, is_active, teacher_id, school_year, display_order) VALUES ($1, true, $2, $3, $4) RETURNING *',
      [name, req.teacher.id, schoolYear, nextOrder]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 주제 활성화/비활성화 토글
app.patch('/api/checklist/topics/:id/toggle', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE checklist_topics SET is_active = NOT is_active WHERE id = $1 AND teacher_id = $2 RETURNING *',
      [id, req.teacher.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 주제 삭제
app.delete('/api/checklist/topics/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM checklist_checks WHERE topic_id = $1', [id]);
    await pool.query('DELETE FROM checklist_items WHERE topic_id = $1', [id]);
    await pool.query('DELETE FROM checklist_topics WHERE id = $1 AND teacher_id = $2', [id, req.teacher.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 항목 목록 조회
app.get('/api/checklist/topics/:topicId/items', authenticate, async (req, res) => {
  try {
    const { topicId } = req.params;
    const result = await pool.query(
      'SELECT * FROM checklist_items WHERE topic_id = $1 ORDER BY display_order, id',
      [topicId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 항목 생성
app.post('/api/checklist/items', authenticate, async (req, res) => {
  try {
    const { topic_id, item_name } = req.body;
    const maxOrderResult = await pool.query(
      'SELECT COALESCE(MAX(display_order), -1) as max_order FROM checklist_items WHERE topic_id = $1',
      [topic_id]
    );
    const nextOrder = maxOrderResult.rows[0].max_order + 1;
    const result = await pool.query(
      'INSERT INTO checklist_items (topic_id, item_name, display_order) VALUES ($1, $2, $3) RETURNING *',
      [topic_id, item_name, nextOrder]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 항목 삭제
app.delete('/api/checklist/items/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM checklist_checks WHERE item_id = $1', [id]);
    await pool.query('DELETE FROM checklist_items WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 체크 상태 조회 (특정 주제의 모든 학생x항목)
app.get('/api/checklist/checks/:topicId', authenticate, async (req, res) => {
  try {
    const { topicId } = req.params;
    const result = await pool.query(
      'SELECT * FROM checklist_checks WHERE topic_id = $1',
      [topicId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 체크리스트 체크 토글
app.post('/api/checklist/checks/toggle', authenticate, async (req, res) => {
  try {
    const { topic_id, item_id, student_id } = req.body;
    
    // 기존 체크 확인
    const existing = await pool.query(
      'SELECT * FROM checklist_checks WHERE topic_id = $1 AND item_id = $2 AND student_id = $3',
      [topic_id, item_id, student_id]
    );
    
    if (existing.rows.length > 0) {
      // 이미 존재하면 토글
      const result = await pool.query(
        'UPDATE checklist_checks SET is_checked = NOT is_checked, checked_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
        [existing.rows[0].id]
      );
      res.json(result.rows[0]);
    } else {
      // 없으면 새로 생성 (체크됨 상태로)
      const result = await pool.query(
        'INSERT INTO checklist_checks (topic_id, item_id, student_id, is_checked) VALUES ($1, $2, $3, true) RETURNING *',
        [topic_id, item_id, student_id]
      );
      res.json(result.rows[0]);
    }
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ============ 자리배치 API ============

// 자리배치 목록 조회
app.get('/api/seating/arrangements', authenticate, async (req, res) => {
  try {
    const schoolYear = resolveYear(req.query.year);
    const result = await pool.query(
      'SELECT * FROM seating_arrangements WHERE teacher_id = $1 AND school_year = $2 ORDER BY created_at DESC',
      [req.teacher.id, schoolYear]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 자리배치 생성
app.post('/api/seating/arrangements', authenticate, async (req, res) => {
  try {
    const { title } = req.body;
    const schoolYear = resolveYear(req.body.school_year);
    const finalTitle = title || new Date().toISOString().split('T')[0];
    
    const result = await pool.query(
      'INSERT INTO seating_arrangements (title, teacher_id, school_year) VALUES ($1, $2, $3) RETURNING *',
      [finalTitle, req.teacher.id, schoolYear]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 자리배치 상세 조회
app.get('/api/seating/arrangements/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    const arrangement = await pool.query(
      'SELECT * FROM seating_arrangements WHERE id = $1 AND teacher_id = $2',
      [id, req.teacher.id]
    );
    
    if (arrangement.rows.length === 0) {
      return res.status(404).json({ error: '자리배치를 찾을 수 없습니다.' });
    }
    
    const positions = await pool.query(
      `SELECT sp.*, s.name, s.student_number 
       FROM seating_positions sp
       JOIN students s ON sp.student_id = s.id
       WHERE sp.arrangement_id = $1`,
      [id]
    );
    
    const preferences = await pool.query(
      'SELECT * FROM seating_preferences WHERE arrangement_id = $1',
      [id]
    );
    
    res.json({
      arrangement: arrangement.rows[0],
      positions: positions.rows,
      preferences: preferences.rows[0] || { front_students: [], separate_students: [] }
    });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 자리배치 삭제
app.delete('/api/seating/arrangements/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      'DELETE FROM seating_arrangements WHERE id = $1 AND teacher_id = $2',
      [id, req.teacher.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 자리 위치 저장
app.put('/api/seating/arrangements/:id/positions', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { positions } = req.body;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      await client.query('DELETE FROM seating_positions WHERE arrangement_id = $1', [id]);
      
      for (const pos of positions) {
        await client.query(
          'INSERT INTO seating_positions (arrangement_id, student_id, row_pos, col_pos) VALUES ($1, $2, $3, $4)',
          [id, pos.student_id, pos.row_pos, pos.col_pos]
        );
      }
      
      await saveSeatingHistory(client, id, positions);
      
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('위치 저장 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 짝/모둠 이력 조회
app.get('/api/seating/history/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const result = await pool.query(
      `SELECT sh.*, sa.title, sa.created_at as arrangement_date
       FROM seating_history sh
       JOIN seating_arrangements sa ON sh.arrangement_id = sa.id
       WHERE sh.student_id = $1 AND sa.teacher_id = $2
       ORDER BY sa.created_at DESC`,
      [studentId, req.teacher.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 설정 저장
app.put('/api/seating/arrangements/:id/preferences', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { front_students, separate_students } = req.body;
    
    const result = await pool.query(
      `INSERT INTO seating_preferences (arrangement_id, front_students, separate_students)
       VALUES ($1, $2, $3)
       ON CONFLICT (arrangement_id) 
       DO UPDATE SET front_students = $2, separate_students = $3
       RETURNING *`,
      [id, front_students || [], separate_students || []]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 짝/모둠 이력 저장 헬퍼 함수
async function saveSeatingHistory(client, arrangementId, positions) {
  const grid = Array(10).fill(null).map(() => Array(10).fill(null));
  positions.forEach(pos => {
    grid[pos.row_pos][pos.col_pos] = pos.student_id;
  });
  
  const visited = Array(10).fill(null).map(() => Array(10).fill(false));
  
  const arrangement = await client.query(
    'SELECT created_at FROM seating_arrangements WHERE id = $1',
    [arrangementId]
  );
  const arrangementDate = arrangement.rows[0].created_at;
  
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      if (grid[i][j] && !visited[i][j]) {
        const group = [];
        const queue = [[i, j]];
        visited[i][j] = true;
        
        while (queue.length > 0) {
          const [r, c] = queue.shift();
          group.push(grid[r][c]);
          
          const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && 
                grid[nr][nc] && !visited[nr][nc]) {
              visited[nr][nc] = true;
              queue.push([nr, nc]);
            }
          }
        }
        
        if (group.length >= 2) {
          const groupType = group.length === 2 ? 'pair' : 'group';
          for (const studentId of group) {
            const partners = group.filter(id => id !== studentId);
            await client.query(
              `INSERT INTO seating_history 
               (arrangement_id, student_id, partner_ids, group_type, arrangement_date)
               VALUES ($1, $2, $3, $4, $5)`,
              [arrangementId, studentId, partners, groupType, arrangementDate]
            );
          }
        }
      }
    }
  }
}


// ============ 발표왕 API ============

// ─── 발표 테이블 자동 생성 + 마이그레이션 ──
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS presentation_records (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        record_date DATE NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        special INTEGER NOT NULL DEFAULT 0,
        arrangement_id INTEGER REFERENCES seating_arrangements(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(student_id, record_date)
      );
      CREATE INDEX IF NOT EXISTS idx_presentation_student ON presentation_records(student_id);
      CREATE INDEX IF NOT EXISTS idx_presentation_date ON presentation_records(record_date);
      CREATE INDEX IF NOT EXISTS idx_presentation_student_date ON presentation_records(student_id, record_date);
    `);
    // 기존 테이블에 arrangement_id 컬럼 추가 (마이그레이션)
    await pool.query(`
      ALTER TABLE presentation_records 
      ADD COLUMN IF NOT EXISTS arrangement_id INTEGER REFERENCES seating_arrangements(id) ON DELETE SET NULL
    `);
    console.log('✓ presentation_records 테이블 확인/생성 완료');
  } catch (e) {
    if (!e.message.includes('already exists')) {
      console.error('presentation_records 테이블 오류:', e.message);
    }
  }
})();

// GET /api/presentations/daily?date=YYYY-MM-DD
app.get('/api/presentations/daily', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT pr.student_id, s.name, s.student_number, pr.count, pr.special, pr.arrangement_id
       FROM presentation_records pr
       JOIN students s ON s.id = pr.student_id
       WHERE pr.record_date = $1
         AND s.teacher_id = $2
         AND s.is_active = true
       ORDER BY pr.count DESC, s.student_number ASC`,
      [targetDate, req.teacher.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[presentations/daily]', err);
    res.status(500).json({ error: '조회 실패' });
  }
});

// POST /api/presentations/increment
app.post('/api/presentations/increment', authenticate, async (req, res) => {
  try {
    const { student_id, date, arrangement_id } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const student = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND teacher_id = $2',
      [student_id, req.teacher.id]
    );
    if (student.rows.length === 0) return res.status(403).json({ error: '권한 없음' });

    const result = await pool.query(
      `INSERT INTO presentation_records (student_id, record_date, count, special, arrangement_id)
       VALUES ($1, $2, 1, 0, $3)
       ON CONFLICT (student_id, record_date)
       DO UPDATE SET count = presentation_records.count + 1,
                     arrangement_id = COALESCE($3, presentation_records.arrangement_id),
                     updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [student_id, targetDate, arrangement_id || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[presentations/increment]', err);
    res.status(500).json({ error: '저장 실패' });
  }
});

// POST /api/presentations/decrement
app.post('/api/presentations/decrement', authenticate, async (req, res) => {
  try {
    const { student_id, date } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const student = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND teacher_id = $2',
      [student_id, req.teacher.id]
    );
    if (student.rows.length === 0) return res.status(403).json({ error: '권한 없음' });

    const result = await pool.query(
      `UPDATE presentation_records
       SET count = GREATEST(0, count - 1), updated_at = CURRENT_TIMESTAMP
       WHERE student_id = $1 AND record_date = $2
       RETURNING *`,
      [student_id, targetDate]
    );
    res.json(result.rows[0] || { count: 0 });
  } catch (err) {
    console.error('[presentations/decrement]', err);
    res.status(500).json({ error: '저장 실패' });
  }
});

// POST /api/presentations/toggle-special
app.post('/api/presentations/toggle-special', authenticate, async (req, res) => {
  try {
    const { student_id, date, arrangement_id } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const student = await pool.query(
      'SELECT id FROM students WHERE id = $1 AND teacher_id = $2',
      [student_id, req.teacher.id]
    );
    if (student.rows.length === 0) return res.status(403).json({ error: '권한 없음' });

    await pool.query(
      `INSERT INTO presentation_records (student_id, record_date, count, special, arrangement_id)
       VALUES ($1, $2, 0, 0, $3)
       ON CONFLICT (student_id, record_date) DO NOTHING`,
      [student_id, targetDate, arrangement_id || null]
    );

    const result = await pool.query(
      `UPDATE presentation_records
       SET special = CASE WHEN special > 0 THEN 0 ELSE 1 END,
           updated_at = CURRENT_TIMESTAMP
       WHERE student_id = $1 AND record_date = $2
       RETURNING *`,
      [student_id, targetDate]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[presentations/toggle-special]', err);
    res.status(500).json({ error: '저장 실패' });
  }
});

// PUT /api/presentations/daily
app.put('/api/presentations/daily', authenticate, async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) return res.json({ saved: 0 });

    let saved = 0;
    for (const entry of entries) {
      const { student_id, count, special, date, arrangement_id } = entry;
      const targetDate = date || new Date().toISOString().split('T')[0];

      const student = await pool.query(
        'SELECT id FROM students WHERE id = $1 AND teacher_id = $2',
        [student_id, req.teacher.id]
      );
      if (student.rows.length === 0) continue;

      await pool.query(
        `INSERT INTO presentation_records (student_id, record_date, count, special, arrangement_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (student_id, record_date)
         DO UPDATE SET count = $3, special = $4,
                       arrangement_id = COALESCE($5, presentation_records.arrangement_id),
                       updated_at = CURRENT_TIMESTAMP`,
        [student_id, targetDate, count || 0, special || 0, arrangement_id || null]
      );
      saved++;
    }
    res.json({ saved });
  } catch (err) {
    console.error('[presentations/daily PUT]', err);
    res.status(500).json({ error: '저장 실패' });
  }
});

// GET /api/presentations/weekly
app.get('/api/presentations/weekly', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const mondayStr = monday.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT pr.student_id, s.name, s.student_number,
              SUM(pr.count)::int AS count,
              SUM(pr.special)::int AS special
       FROM presentation_records pr
       JOIN students s ON s.id = pr.student_id
       WHERE pr.record_date BETWEEN $1 AND $2
         AND s.teacher_id = $3
         AND s.is_active = true
       GROUP BY pr.student_id, s.name, s.student_number
       ORDER BY count DESC, s.student_number ASC`,
      [mondayStr, todayStr, req.teacher.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[presentations/weekly]', err);
    res.status(500).json({ error: '조회 실패' });
  }
});

// GET /api/presentations/stats
app.get('/api/presentations/stats', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const mondayStr = monday.toISOString().split('T')[0];
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfMonthStr = firstOfMonth.toISOString().split('T')[0];

    const todayResult = await pool.query(
      `SELECT SUM(pr.count)::int AS total, s.name, pr.count
       FROM presentation_records pr JOIN students s ON s.id = pr.student_id
       WHERE pr.record_date = $1 AND s.teacher_id = $2
       GROUP BY s.name, pr.count ORDER BY pr.count DESC`,
      [todayStr, req.teacher.id]
    );

    const weekResult = await pool.query(
      `SELECT s.name, SUM(pr.count)::int as scount
       FROM presentation_records pr JOIN students s ON s.id = pr.student_id
       WHERE pr.record_date BETWEEN $1 AND $2 AND s.teacher_id = $3
       GROUP BY s.name ORDER BY scount DESC`,
      [mondayStr, todayStr, req.teacher.id]
    );

    const monthResult = await pool.query(
      `SELECT s.name, SUM(pr.count)::int as scount
       FROM presentation_records pr JOIN students s ON s.id = pr.student_id
       WHERE pr.record_date BETWEEN $1 AND $2 AND s.teacher_id = $3
       GROUP BY s.name ORDER BY scount DESC`,
      [firstOfMonthStr, todayStr, req.teacher.id]
    );

    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(now.getDate() - 13);
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0];

    const trendResult = await pool.query(
      `SELECT s.id as student_id, s.name, pr.record_date, pr.count
       FROM presentation_records pr JOIN students s ON s.id = pr.student_id
       WHERE pr.record_date BETWEEN $1 AND $2 AND s.teacher_id = $3 AND s.is_active = true
       ORDER BY s.student_number, pr.record_date`,
      [twoWeeksAgoStr, todayStr, req.teacher.id]
    );

    const studentMap = {};
    trendResult.rows.forEach(row => {
      if (!studentMap[row.student_id]) {
        studentMap[row.student_id] = { student_id: row.student_id, name: row.name, daily: [] };
      }
      studentMap[row.student_id].daily.push({
        date: row.record_date.toISOString ? row.record_date.toISOString().split('T')[0] : String(row.record_date).split('T')[0],
        count: parseInt(row.count)
      });
    });

    const trends = Object.values(studentMap).map(s => {
      const recent = s.daily.slice(-7);
      const half = Math.floor(recent.length / 2);
      const firstHalf = recent.slice(0, half).reduce((sum, d) => sum + d.count, 0);
      const secondHalf = recent.slice(half).reduce((sum, d) => sum + d.count, 0);
      let trend = 'flat';
      if (secondHalf > firstHalf + 1) trend = 'up';
      else if (firstHalf > secondHalf + 1) trend = 'down';
      return { ...s, trend };
    });

    const todayTotal = todayResult.rows.reduce((s, r) => s + parseInt(r.count || 0), 0);
    const weekTotal = weekResult.rows.reduce((s, r) => s + parseInt(r.scount || 0), 0);
    const monthTotal = monthResult.rows.reduce((s, r) => s + parseInt(r.scount || 0), 0);

    res.json({
      today_total: todayTotal,
      today_top: todayResult.rows[0] ? { name: todayResult.rows[0].name, count: todayResult.rows[0].count } : null,
      week_total: weekTotal,
      week_top: weekResult.rows[0] ? { name: weekResult.rows[0].name, count: parseInt(weekResult.rows[0].scount) } : null,
      month_total: monthTotal,
      month_top: monthResult.rows[0] ? { name: monthResult.rows[0].name, count: parseInt(monthResult.rows[0].scount) } : null,
      trends
    });
  } catch (err) {
    console.error('[presentations/stats]', err);
    res.status(500).json({ error: '통계 조회 실패' });
  }
});

// PUT /api/presentations/admin/:studentId
app.put('/api/presentations/admin/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { date, count, special } = req.body;
    const student = await pool.query('SELECT id FROM students WHERE id = $1 AND teacher_id = $2', [studentId, req.teacher.id]);
    if (student.rows.length === 0) return res.status(403).json({ error: '권한 없음' });

    await pool.query(
      `INSERT INTO presentation_records (student_id, record_date, count, special)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, record_date)
       DO UPDATE SET count = $3, special = $4, updated_at = CURRENT_TIMESTAMP`,
      [studentId, date, count ?? 0, special ?? 0]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[presentations/admin PUT]', err);
    res.status(500).json({ error: '수정 실패' });
  }
});

// DELETE /api/presentations/admin/:studentId
app.delete('/api/presentations/admin/:studentId', authenticate, async (req, res) => {
  try {
    const { studentId } = req.params;
    const { date } = req.query;
    const student = await pool.query('SELECT id FROM students WHERE id = $1 AND teacher_id = $2', [studentId, req.teacher.id]);
    if (student.rows.length === 0) return res.status(403).json({ error: '권한 없음' });

    await pool.query('DELETE FROM presentation_records WHERE student_id = $1 AND record_date = $2', [studentId, date]);
    res.json({ success: true });
  } catch (err) {
    console.error('[presentations/admin DELETE]', err);
    res.status(500).json({ error: '삭제 실패' });
  }
});

// ============ 정적 파일 서빙 ============
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✓ 서버가 포트 ${PORT}에서 실행 중입니다.`);
});

import pool from './db.js';

export async function initializeDatabase() {
  try {
    console.log('📊 데이터베이스 스키마 확인 중...');

    // teachers 테이블 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // students 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_number INTEGER NOT NULL,
        name VARCHAR(100) NOT NULL,
        teacher_id INTEGER REFERENCES teachers(id),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deactivated_at TIMESTAMP
      )
    `);

    // evaluation_categories 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS evaluation_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        max_score INTEGER NOT NULL,
        teacher_id INTEGER REFERENCES teachers(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        display_order INTEGER DEFAULT 0
      )
    `);

    // evaluation_records 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS evaluation_records (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES evaluation_categories(id) ON DELETE CASCADE,
        score DECIMAL(10, 2) NOT NULL,
        title VARCHAR(200) DEFAULT '',
        evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 기존 컬럼 추가 (이미 있으면 무시)
    await pool.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id)`);
    await pool.query(`ALTER TABLE evaluation_categories ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id)`);
    await pool.query(`ALTER TABLE evaluation_records ADD COLUMN IF NOT EXISTS title VARCHAR(200) DEFAULT ''`);

    // updated_at 트리거
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
      $$ language 'plpgsql'
    `);
    await pool.query(`
      DROP TRIGGER IF EXISTS update_evaluation_records_updated_at ON evaluation_records;
      CREATE TRIGGER update_evaluation_records_updated_at
        BEFORE UPDATE ON evaluation_records
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);

    console.log('✓ 데이터베이스 스키마가 준비되었습니다.');
  } catch (error) {
    console.error('❌ 데이터베이스 초기화 오류:', error);
  }
}

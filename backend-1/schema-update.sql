-- 선생님 계정 테이블 (기존 auth 대체)
CREATE TABLE IF NOT EXISTS teachers (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  is_admin BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 기존 students에 teacher_id 추가
ALTER TABLE students ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id);

-- 기존 evaluation_categories에 teacher_id 추가
ALTER TABLE evaluation_categories ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES teachers(id);

-- 기존 데이터를 첫 번째 선생님(관리자)에 연결하기 위한 준비
-- (서버 코드에서 처리)

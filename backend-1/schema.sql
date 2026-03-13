-- 데이터베이스 스키마

-- 인증 테이블
CREATE TABLE IF NOT EXISTS auth (
    id SERIAL PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 학생 테이블
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    student_number INTEGER NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deactivated_at TIMESTAMP
);

-- 평가 카테고리 테이블 (줄넘기, 받아쓰기, 수학 등)
CREATE TABLE IF NOT EXISTS evaluation_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    max_score INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    display_order INTEGER DEFAULT 0
);

-- 평가 기록 테이블
CREATE TABLE IF NOT EXISTS evaluation_records (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES evaluation_categories(id) ON DELETE CASCADE,
    score DECIMAL(10, 2) NOT NULL,
    evaluation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_students_active ON students(is_active);
CREATE INDEX IF NOT EXISTS idx_students_number ON students(student_number);
CREATE INDEX IF NOT EXISTS idx_evaluation_records_student ON evaluation_records(student_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_records_category ON evaluation_records(category_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_records_date ON evaluation_records(evaluation_date);

-- 평가 기록 업데이트 시간 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_evaluation_records_updated_at 
    BEFORE UPDATE ON evaluation_records 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

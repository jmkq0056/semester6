-- Database Schema V2 - Multi-Subject Support
-- Migration from single-subject to multi-subject architecture

-- Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT,
    semester TEXT,
    color TEXT,
    icon TEXT,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Files Table (NEW - centralizes all file information)
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,  -- notes, slides, exercises, exercises-no-solutions, blueprint, teachers-method
    lecture_number INTEGER,
    file_type TEXT DEFAULT 'PDF',
    file_size INTEGER,
    page_count INTEGER,
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP,
    access_count INTEGER DEFAULT 0,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

-- Enhanced History Table
CREATE TABLE IF NOT EXISTS history_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER,
    subject_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    filepath TEXT NOT NULL,
    category TEXT,
    page_number INTEGER DEFAULT 1,
    was_split_view BOOLEAN DEFAULT 0,
    accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE SET NULL,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

-- File Metadata for Search (full-text search support)
CREATE TABLE IF NOT EXISTS file_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    page_number INTEGER,
    content_text TEXT,
    toc_entry TEXT,
    search_vector TEXT, -- For full-text search indexing
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- Split View Companions (tracks which PDFs are commonly viewed together)
CREATE TABLE IF NOT EXISTS split_companions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id_left INTEGER NOT NULL,
    file_id_right INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    use_count INTEGER DEFAULT 1,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id_left) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id_right) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    UNIQUE(file_id_left, file_id_right, subject_id)
);

-- User Preferences
CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_files_subject ON files(subject_id);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_lecture ON files(lecture_number);
CREATE INDEX IF NOT EXISTS idx_history_subject ON history_v2(subject_id);
CREATE INDEX IF NOT EXISTS idx_history_file ON history_v2(file_id);
CREATE INDEX IF NOT EXISTS idx_history_accessed ON history_v2(accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_metadata_file ON file_metadata(file_id);
CREATE INDEX IF NOT EXISTS idx_metadata_page ON file_metadata(page_number);

-- Full-text search virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS file_search_fts USING fts5(
    filename,
    filepath,
    category,
    content,
    content=file_metadata,
    content_rowid=id
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS file_metadata_ai AFTER INSERT ON file_metadata BEGIN
    INSERT INTO file_search_fts(rowid, filename, filepath, category, content)
    SELECT
        NEW.id,
        f.filename,
        f.filepath,
        f.category,
        NEW.content_text
    FROM files f WHERE f.id = NEW.file_id;
END;

CREATE TRIGGER IF NOT EXISTS file_metadata_ad AFTER DELETE ON file_metadata BEGIN
    DELETE FROM file_search_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS file_metadata_au AFTER UPDATE ON file_metadata BEGIN
    DELETE FROM file_search_fts WHERE rowid = OLD.id;
    INSERT INTO file_search_fts(rowid, filename, filepath, category, content)
    SELECT
        NEW.id,
        f.filename,
        f.filepath,
        f.category,
        NEW.content_text
    FROM files f WHERE f.id = NEW.file_id;
END;

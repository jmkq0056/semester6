const Database = require('better-sqlite3');
const path = require('path');

// Initialize database - now in data/ folder
const DATA_DIR = path.join(__dirname, '..', 'data');
const db = new Database(path.join(DATA_DIR, 'pdf-viewer.db'));

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Create tables
function initializeDatabase() {
    // Subjects table
    db.exec(`
        CREATE TABLE IF NOT EXISTS subjects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            code TEXT NOT NULL UNIQUE,
            semester TEXT,
            color TEXT DEFAULT '#007AFF',
            icon TEXT DEFAULT 'fa-book',
            custom_svg TEXT,
            is_active INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
    `);

    // Add custom_svg column if it doesn't exist (migration for existing databases)
    try {
        db.exec(`ALTER TABLE subjects ADD COLUMN custom_svg TEXT`);
        console.log('✅ Added custom_svg column to subjects table');
    } catch (error) {
        // Column already exists, ignore
        if (!error.message.includes('duplicate column name')) {
            console.error('Error adding custom_svg column:', error);
        }
    }

    // History table - fixed with proper UNIQUE constraint
    db.exec(`
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_code TEXT NOT NULL,
            title TEXT NOT NULL,
            path TEXT NOT NULL,
            category TEXT,
            was_split_view INTEGER DEFAULT 0,
            timestamp INTEGER NOT NULL,
            access_count INTEGER DEFAULT 1,
            UNIQUE(subject_code, path)
        )
    `);

    // Split companions table (bidirectional relationships)
    db.exec(`
        CREATE TABLE IF NOT EXISTS split_companions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            left_path TEXT NOT NULL,
            right_path TEXT NOT NULL,
            last_used INTEGER NOT NULL,
            UNIQUE(left_path, right_path)
        )
    `);

    // User preferences table
    db.exec(`
        CREATE TABLE IF NOT EXISTS preferences (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `);

    // Custom categories per subject
    db.exec(`
        CREATE TABLE IF NOT EXISTS custom_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_code TEXT NOT NULL,
            category_name TEXT NOT NULL,
            category_id TEXT NOT NULL,
            icon TEXT DEFAULT 'fa-folder',
            color TEXT DEFAULT '#007AFF',
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            UNIQUE(subject_code, category_id)
        )
    `);

    // Migration: Add category_id column if it doesn't exist
    try {
        db.exec(`ALTER TABLE custom_categories ADD COLUMN category_id TEXT`);
    } catch (e) {
        // Column already exists, ignore
    }

    // Migration: Populate category_id from category_name for existing rows
    db.exec(`
        UPDATE custom_categories
        SET category_id = LOWER(REPLACE(REPLACE(category_name, ' ', '-'), '_', '-'))
        WHERE category_id IS NULL OR category_id = ''
    `);

    // Chat history for Ask Claude feature
    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_path TEXT NOT NULL,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            source_type TEXT DEFAULT 'tex',
            timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
    `);

    // TeX Version Control table
    db.exec(`
        CREATE TABLE IF NOT EXISTS tex_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            version_number INTEGER NOT NULL,
            content TEXT NOT NULL,
            summary TEXT,
            source TEXT DEFAULT 'user',
            is_current INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            UNIQUE(file_path, version_number)
        )
    `);

    // Claude-generated slides table
    db.exec(`
        CREATE TABLE IF NOT EXISTS claude_slides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject_code TEXT NOT NULL,
            title TEXT NOT NULL,
            question TEXT NOT NULL,
            content TEXT NOT NULL,
            source_document TEXT,
            source_type TEXT DEFAULT 'tex',
            lecture_number INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
    `);

    // Create index for claude_slides
    try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_slides_subject ON claude_slides(subject_code)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_slides_created ON claude_slides(created_at DESC)`);
    } catch (error) {
        // Indexes might already exist
    }

    // Create indexes for version control
    try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_versions_file ON tex_versions(file_path)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_versions_current ON tex_versions(file_path, is_current)`);
    } catch (error) {
        // Indexes might already exist
    }

    // ============================================================================
    // LATEX PROJECTS TABLES
    // ============================================================================

    // LaTeX Projects table
    db.exec(`
        CREATE TABLE IF NOT EXISTS latex_projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT 'default',
            name TEXT NOT NULL,
            description TEXT,
            main_file TEXT DEFAULT 'main.tex',
            path TEXT NOT NULL UNIQUE,
            compiler TEXT DEFAULT 'pdflatex',
            auto_compile INTEGER DEFAULT 1,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
    `);

    // Project Files table (tracks files within project)
    db.exec(`
        CREATE TABLE IF NOT EXISTS project_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            file_type TEXT DEFAULT 'tex',
            is_main INTEGER DEFAULT 0,
            last_modified INTEGER,
            FOREIGN KEY (project_id) REFERENCES latex_projects(id) ON DELETE CASCADE,
            UNIQUE(project_id, file_path)
        )
    `);

    // YouTube references in projects
    db.exec(`
        CREATE TABLE IF NOT EXISTS project_youtube_refs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            video_id TEXT NOT NULL,
            video_title TEXT,
            timestamp_seconds INTEGER DEFAULT 0,
            note TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            FOREIGN KEY (project_id) REFERENCES latex_projects(id) ON DELETE CASCADE
        )
    `);

    // Project version snapshots
    db.exec(`
        CREATE TABLE IF NOT EXISTS project_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            version_number INTEGER NOT NULL,
            snapshot_data TEXT,
            summary TEXT,
            source TEXT DEFAULT 'user',
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
            FOREIGN KEY (project_id) REFERENCES latex_projects(id) ON DELETE CASCADE,
            UNIQUE(project_id, version_number)
        )
    `);

    // Create indexes for latex projects
    try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_user ON latex_projects(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_project_files ON project_files(project_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_project_youtube ON project_youtube_refs(project_id)`);
    } catch (error) {
        // Indexes might already exist
    }

    // Create index for faster chat history lookups
    try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_document ON chat_history(document_path)`);
    } catch (error) {
        // Index might already exist
    }

    // Add icon and color columns if they don't exist (migration for existing databases)
    try {
        db.exec(`ALTER TABLE custom_categories ADD COLUMN icon TEXT DEFAULT 'fa-folder'`);
        console.log('✅ Added icon column to custom_categories table');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Error adding icon column:', error);
        }
    }

    try {
        db.exec(`ALTER TABLE custom_categories ADD COLUMN color TEXT DEFAULT '#007AFF'`);
        console.log('✅ Added color column to custom_categories table');
    } catch (error) {
        if (!error.message.includes('duplicate column name')) {
            console.error('Error adding color column:', error);
        }
    }

    // Create indexes for better performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_history_path ON history(path);
        CREATE INDEX IF NOT EXISTS idx_history_subject ON history(subject_code);
        CREATE INDEX IF NOT EXISTS idx_split_left ON split_companions(left_path);
        CREATE INDEX IF NOT EXISTS idx_split_right ON split_companions(right_path);
    `);

    // Migrate history table if needed (fix incorrect UNIQUE constraint)
    try {
        // Check if history table has the correct schema
        const schemaCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='history'").get();

        if (schemaCheck && schemaCheck.sql) {
            // Check if schema has incorrect UNIQUE(path) instead of UNIQUE(subject_code, path)
            const hasIncorrectUnique = schemaCheck.sql.includes('path TEXT NOT NULL UNIQUE') ||
                                      (!schemaCheck.sql.includes('UNIQUE(subject_code, path)') &&
                                       !schemaCheck.sql.includes('subject_code TEXT NOT NULL'));

            if (hasIncorrectUnique) {
                console.log('⚠️  Detected incorrect history schema, migrating...');

                // Backup old data
                const oldData = db.prepare('SELECT * FROM history').all();

                // Drop old table and indexes
                db.exec('DROP INDEX IF EXISTS idx_history_timestamp');
                db.exec('DROP INDEX IF EXISTS idx_history_path');
                db.exec('DROP INDEX IF EXISTS idx_history_subject');
                db.exec('DROP TABLE history');

                // Recreate with correct schema
                db.exec(`
                    CREATE TABLE history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        subject_code TEXT NOT NULL,
                        title TEXT NOT NULL,
                        path TEXT NOT NULL,
                        category TEXT,
                        was_split_view INTEGER DEFAULT 0,
                        timestamp INTEGER NOT NULL,
                        access_count INTEGER DEFAULT 1,
                        UNIQUE(subject_code, path)
                    )
                `);

                // Recreate indexes
                db.exec(`
                    CREATE INDEX idx_history_timestamp ON history(timestamp DESC);
                    CREATE INDEX idx_history_path ON history(path);
                    CREATE INDEX idx_history_subject ON history(subject_code);
                `);

                // Restore data with subject_code
                if (oldData.length > 0) {
                    const insertStmt = db.prepare(`
                        INSERT OR IGNORE INTO history (id, subject_code, title, path, category, was_split_view, timestamp, access_count)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    for (const row of oldData) {
                        insertStmt.run(
                            row.id,
                            row.subject_code || 'AC',
                            row.title,
                            row.path,
                            row.category,
                            row.was_split_view,
                            row.timestamp,
                            row.access_count
                        );
                    }
                    console.log(`✅ Migrated ${oldData.length} history entries`);
                }

                console.log('✅ History table migration completed successfully');
            }
        }
    } catch (error) {
        console.error('❌ Error during history table migration:', error);
    }

    // Create default subjects if none exist
    try {
        const subjectsCount = db.prepare('SELECT COUNT(*) as count FROM subjects').get();
        if (subjectsCount.count === 0) {
            db.prepare(`
                INSERT INTO subjects (name, code, semester, color, icon)
                VALUES (?, ?, ?, ?, ?)
            `).run('Algorithms and Computability', 'AC', 'Spring 2026', '#e74c3c', 'fa-microchip');

            db.prepare(`
                INSERT INTO subjects (name, code, semester, color, icon)
                VALUES (?, ?, ?, ?, ?)
            `).run('Models and Tools for Cyber Physical Systems', 'MTCPS', 'Spring 2026', '#2ecc71', 'fa-cogs');

            // Add exam as custom category for MTCPS
            db.prepare(`
                INSERT INTO custom_categories (subject_code, category_name, category_id, icon, color)
                VALUES (?, ?, ?, ?, ?)
            `).run('MTCPS', 'Exam', 'exam', 'fa-file-alt', '#e74c3c');

            // Set AC as current subject
            db.prepare(`
                INSERT OR REPLACE INTO preferences (key, value, updated_at)
                VALUES ('currentSubject', 'AC', ?)
            `).run(Date.now());

            console.log('Created default subjects: AC, MTCPS');
        }
    } catch (error) {
        console.error('Error creating default subjects:', error);
    }

    console.log('Database initialized successfully');
}

// ============================================================================
// HISTORY OPERATIONS
// ============================================================================

function addToHistory(title, path, category, wasSplitView = false) {
    // Get current subject
    const currentSubject = getCurrentSubject();
    const subjectCode = currentSubject ? currentSubject.code : 'AC';

    const stmt = db.prepare(`
        INSERT INTO history (subject_code, title, path, category, was_split_view, timestamp, access_count)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(subject_code, path) DO UPDATE SET
            title = excluded.title,
            category = excluded.category,
            was_split_view = excluded.was_split_view,
            timestamp = excluded.timestamp,
            access_count = access_count + 1
    `);

    try {
        stmt.run(subjectCode, title, path, category, wasSplitView ? 1 : 0, Date.now());
        return { success: true };
    } catch (error) {
        console.error('Error adding to history:', error);
        return { success: false, error: error.message };
    }
}

function getHistory(limit = 20) {
    // Get current subject
    const currentSubject = getCurrentSubject();
    const subjectCode = currentSubject ? currentSubject.code : 'AC';

    // Only get history from the last 60 days
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);

    const stmt = db.prepare(`
        SELECT title, path, category, was_split_view, timestamp, access_count
        FROM history
        WHERE subject_code = ? AND timestamp > ?
        ORDER BY timestamp DESC
        LIMIT ?
    `);

    try {
        const rows = stmt.all(subjectCode, sixtyDaysAgo, limit);
        return rows.map(row => ({
            title: row.title,
            path: row.path,
            category: row.category,
            wasSplitView: row.was_split_view === 1,
            timestamp: row.timestamp,
            accessCount: row.access_count
        }));
    } catch (error) {
        console.error('Error getting history:', error);
        return [];
    }
}

function clearHistory() {
    try {
        db.prepare('DELETE FROM history').run();
        return { success: true };
    } catch (error) {
        console.error('Error clearing history:', error);
        return { success: false, error: error.message };
    }
}

function deleteHistoryItem(path) {
    try {
        db.prepare('DELETE FROM history WHERE path = ?').run(path);
        return { success: true };
    } catch (error) {
        console.error('Error deleting history item:', error);
        return { success: false, error: error.message };
    }
}

function cleanupOldHistory() {
    // Remove history entries older than 60 days
    const sixtyDaysAgo = Date.now() - (60 * 24 * 60 * 60 * 1000);

    try {
        const result = db.prepare('DELETE FROM history WHERE timestamp < ?').run(sixtyDaysAgo);
        console.log(`Cleaned up ${result.changes} old history entries`);
        return { success: true, removed: result.changes };
    } catch (error) {
        console.error('Error cleaning up old history:', error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// SPLIT COMPANIONS OPERATIONS
// ============================================================================

function saveSplitCompanion(leftPath, rightPath) {
    const stmt = db.prepare(`
        INSERT INTO split_companions (left_path, right_path, last_used)
        VALUES (?, ?, ?)
        ON CONFLICT(left_path, right_path) DO UPDATE SET
            last_used = excluded.last_used
    `);

    const timestamp = Date.now();

    try {
        // Save both directions
        stmt.run(leftPath, rightPath, timestamp);
        stmt.run(rightPath, leftPath, timestamp);
        return { success: true };
    } catch (error) {
        console.error('Error saving split companion:', error);
        return { success: false, error: error.message };
    }
}

function getSplitCompanion(path) {
    const stmt = db.prepare(`
        SELECT right_path
        FROM split_companions
        WHERE left_path = ?
        ORDER BY last_used DESC
        LIMIT 1
    `);

    try {
        const row = stmt.get(path);
        return row ? row.right_path : null;
    } catch (error) {
        console.error('Error getting split companion:', error);
        return null;
    }
}

function getAllSplitCompanions() {
    const stmt = db.prepare(`
        SELECT left_path, right_path, last_used
        FROM split_companions
        ORDER BY last_used DESC
    `);

    try {
        return stmt.all();
    } catch (error) {
        console.error('Error getting all split companions:', error);
        return [];
    }
}

// ============================================================================
// PREFERENCES OPERATIONS
// ============================================================================

function setPreference(key, value) {
    const stmt = db.prepare(`
        INSERT INTO preferences (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
    `);

    try {
        stmt.run(key, typeof value === 'string' ? value : JSON.stringify(value), Date.now());
        return { success: true };
    } catch (error) {
        console.error('Error setting preference:', error);
        return { success: false, error: error.message };
    }
}

function getPreference(key, defaultValue = null) {
    const stmt = db.prepare('SELECT value FROM preferences WHERE key = ?');

    try {
        const row = stmt.get(key);
        if (!row) return defaultValue;

        // Try to parse JSON, otherwise return as string
        try {
            return JSON.parse(row.value);
        } catch {
            return row.value;
        }
    } catch (error) {
        console.error('Error getting preference:', error);
        return defaultValue;
    }
}

function getAllPreferences() {
    const stmt = db.prepare('SELECT key, value FROM preferences');

    try {
        const rows = stmt.all();
        const prefs = {};
        rows.forEach(row => {
            try {
                prefs[row.key] = JSON.parse(row.value);
            } catch {
                prefs[row.key] = row.value;
            }
        });
        return prefs;
    } catch (error) {
        console.error('Error getting all preferences:', error);
        return {};
    }
}

// ============================================================================
// STATISTICS & ANALYTICS
// ============================================================================

function getStatistics() {
    try {
        const totalViews = db.prepare('SELECT SUM(access_count) as total FROM history').get();
        const uniquePDFs = db.prepare('SELECT COUNT(*) as count FROM history').get();
        const splitViewCount = db.prepare('SELECT COUNT(*) as count FROM history WHERE was_split_view = 1').get();
        const mostViewed = db.prepare(`
            SELECT title, path, access_count
            FROM history
            ORDER BY access_count DESC
            LIMIT 5
        `).all();

        return {
            totalViews: totalViews.total || 0,
            uniquePDFs: uniquePDFs.count || 0,
            splitViewUsage: splitViewCount.count || 0,
            mostViewed
        };
    } catch (error) {
        console.error('Error getting statistics:', error);
        return null;
    }
}

// ============================================================================
// EXPORT & BACKUP
// ============================================================================

function exportData() {
    try {
        return {
            history: getHistory(1000),
            splitCompanions: getAllSplitCompanions(),
            preferences: getAllPreferences(),
            statistics: getStatistics()
        };
    } catch (error) {
        console.error('Error exporting data:', error);
        return null;
    }
}

// ============================================================================
// MULTI-SUBJECT OPERATIONS (V2 Schema)
// ============================================================================

function getSubjects() {
    try {
        const stmt = db.prepare(`
            SELECT * FROM subjects WHERE is_active = 1 ORDER BY name
        `);
        return stmt.all();
    } catch (error) {
        console.error('Error getting subjects:', error);
        return [];
    }
}

function createSubject(name, code, semester, color = '#007AFF', icon = 'fa-book', custom_svg = null) {
    const stmt = db.prepare(`
        INSERT INTO subjects (name, code, semester, color, icon, custom_svg)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
        const result = stmt.run(name, code, semester, color, icon, custom_svg);
        return { success: true, id: result.lastInsertRowid };
    } catch (error) {
        console.error('Error creating subject:', error);
        return { success: false, error: error.message };
    }
}

function updateSubject(id, data) {
    const fields = [];
    const values = [];

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.code !== undefined) { fields.push('code = ?'); values.push(data.code); }
    if (data.semester !== undefined) { fields.push('semester = ?'); values.push(data.semester); }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color); }
    if (data.icon !== undefined) { fields.push('icon = ?'); values.push(data.icon); }
    if (data.custom_svg !== undefined) { fields.push('custom_svg = ?'); values.push(data.custom_svg); }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const stmt = db.prepare(`
        UPDATE subjects SET ${fields.join(', ')} WHERE id = ?
    `);

    try {
        stmt.run(...values);
        return { success: true };
    } catch (error) {
        console.error('Error updating subject:', error);
        return { success: false, error: error.message };
    }
}

function deleteSubject(id) {
    try {
        db.prepare('UPDATE subjects SET is_active = 0 WHERE id = ?').run(id);
        return { success: true };
    } catch (error) {
        console.error('Error deleting subject:', error);
        return { success: false, error: error.message };
    }
}

function getCurrentSubject() {
    const code = getPreference('currentSubject', 'AC');
    const stmt = db.prepare('SELECT * FROM subjects WHERE code = ? AND is_active = 1');

    try {
        return stmt.get(code);
    } catch (error) {
        console.error('Error getting current subject:', error);
        return null;
    }
}

function setCurrentSubject(code) {
    return setPreference('currentSubject', code);
}

// Initialize database on module load
initializeDatabase();

// Run cleanup on startup
cleanupOldHistory();

// Schedule cleanup every 24 hours
setInterval(() => {
    cleanupOldHistory();
}, 24 * 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    console.log('Database connection closed');
    process.exit(0);
});

// ============================================================================
// CUSTOM CATEGORIES
// ============================================================================

function addCustomCategory(subjectCode, categoryName, categoryId, icon = 'fa-folder', color = '#007AFF') {
    // If categoryId not provided, generate from categoryName
    if (!categoryId) {
        categoryId = categoryName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }

    const stmt = db.prepare(`
        INSERT INTO custom_categories (subject_code, category_name, category_id, icon, color)
        VALUES (?, ?, ?, ?, ?)
    `);

    try {
        stmt.run(subjectCode, categoryName, categoryId, icon, color);
        return { success: true };
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            return { success: true, message: 'Category already exists' };
        }
        console.error('Error adding custom category:', error);
        return { success: false, error: error.message };
    }
}

function getCustomCategories(subjectCode) {
    const stmt = db.prepare(`
        SELECT category_name, category_id, icon, color
        FROM custom_categories
        WHERE subject_code = ?
        ORDER BY category_name
    `);

    try {
        const rows = stmt.all(subjectCode);
        return rows.map(row => ({
            id: row.category_id || row.category_name.toLowerCase().replace(/\s+/g, '-'),
            name: row.category_name,
            icon: row.icon || 'fa-folder',
            color: row.color || '#007AFF'
        }));
    } catch (error) {
        console.error('Error getting custom categories:', error);
        return [];
    }
}

function formatCategoryName(categoryName) {
    return categoryName
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function renameCustomCategory(subjectCode, oldCategoryName, newCategoryName) {
    const stmt = db.prepare(`
        UPDATE custom_categories
        SET category_name = ?
        WHERE subject_code = ? AND category_name = ?
    `);

    try {
        stmt.run(newCategoryName, subjectCode, oldCategoryName);
        return { success: true };
    } catch (error) {
        console.error('Error renaming custom category:', error);
        return { success: false, error: error.message };
    }
}

function deleteCustomCategory(subjectCode, categoryName) {
    const stmt = db.prepare(`
        DELETE FROM custom_categories
        WHERE subject_code = ? AND category_name = ?
    `);

    try {
        stmt.run(subjectCode, categoryName);
        return { success: true };
    } catch (error) {
        console.error('Error deleting custom category:', error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// CHAT HISTORY (Ask Claude Feature)
// ============================================================================

function saveChatHistory(documentPath, question, answer, sourceType = 'tex') {
    const stmt = db.prepare(`
        INSERT INTO chat_history (document_path, question, answer, source_type, timestamp)
        VALUES (?, ?, ?, ?, ?)
    `);

    try {
        stmt.run(documentPath, question, answer, sourceType, Date.now());
        return { success: true };
    } catch (error) {
        console.error('Error saving chat history:', error);
        return { success: false, error: error.message };
    }
}

function getChatHistory(documentPath, limit = 50) {
    const stmt = db.prepare(`
        SELECT question, answer, source_type, timestamp
        FROM chat_history
        WHERE document_path = ?
        ORDER BY timestamp ASC
        LIMIT ?
    `);

    try {
        const rows = stmt.all(documentPath, limit);
        return rows.map(row => ({
            question: row.question,
            answer: row.answer,
            sourceType: row.source_type,
            timestamp: row.timestamp
        }));
    } catch (error) {
        console.error('Error getting chat history:', error);
        return [];
    }
}

function clearChatHistory(documentPath) {
    try {
        if (documentPath) {
            db.prepare('DELETE FROM chat_history WHERE document_path = ?').run(documentPath);
        } else {
            db.prepare('DELETE FROM chat_history').run();
        }
        return { success: true };
    } catch (error) {
        console.error('Error clearing chat history:', error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// TEX VERSION CONTROL
// ============================================================================

/**
 * Save a new version of a tex file
 * @param {string} filePath - Path to the tex file
 * @param {string} content - File content
 * @param {string} summary - Summary of changes (can be null for user edits)
 * @param {string} source - 'user' or 'claude'
 * @returns {Object} Result with version info
 */
function saveTexVersion(filePath, content, summary = null, source = 'user') {
    try {
        // Get the next version number for this file
        const lastVersion = db.prepare(`
            SELECT MAX(version_number) as max_version
            FROM tex_versions
            WHERE file_path = ?
        `).get(filePath);

        const nextVersion = (lastVersion?.max_version || 0) + 1;

        // Mark all existing versions as not current
        db.prepare(`
            UPDATE tex_versions
            SET is_current = 0
            WHERE file_path = ?
        `).run(filePath);

        // Insert new version as current
        const result = db.prepare(`
            INSERT INTO tex_versions (file_path, version_number, content, summary, source, is_current, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
        `).run(filePath, nextVersion, content, summary, source, Date.now());

        return {
            success: true,
            versionId: result.lastInsertRowid,
            versionNumber: nextVersion
        };
    } catch (error) {
        console.error('Error saving tex version:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get all versions of a tex file
 * @param {string} filePath - Path to the tex file
 * @param {number} limit - Max versions to return (0 for all)
 * @returns {Array} List of versions
 */
function getTexVersions(filePath, limit = 50) {
    try {
        let query = `
            SELECT id, version_number, summary, source, is_current, created_at,
                   LENGTH(content) as content_length
            FROM tex_versions
            WHERE file_path = ?
            ORDER BY version_number DESC
        `;
        if (limit > 0) {
            query += ` LIMIT ?`;
        }

        const stmt = db.prepare(query);
        const rows = limit > 0 ? stmt.all(filePath, limit) : stmt.all(filePath);

        return rows.map(row => ({
            id: row.id,
            versionNumber: row.version_number,
            summary: row.summary,
            source: row.source,
            isCurrent: row.is_current === 1,
            createdAt: row.created_at,
            contentLength: row.content_length
        }));
    } catch (error) {
        console.error('Error getting tex versions:', error);
        return [];
    }
}

/**
 * Get a specific version's content
 * @param {string} filePath - Path to the tex file
 * @param {number} versionNumber - Version number to retrieve
 * @returns {Object} Version content and metadata
 */
function getTexVersionContent(filePath, versionNumber) {
    try {
        const row = db.prepare(`
            SELECT id, version_number, content, summary, source, is_current, created_at
            FROM tex_versions
            WHERE file_path = ? AND version_number = ?
        `).get(filePath, versionNumber);

        if (!row) {
            return { success: false, error: 'Version not found' };
        }

        return {
            success: true,
            id: row.id,
            versionNumber: row.version_number,
            content: row.content,
            summary: row.summary,
            source: row.source,
            isCurrent: row.is_current === 1,
            createdAt: row.created_at
        };
    } catch (error) {
        console.error('Error getting tex version content:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get current version of a tex file
 * @param {string} filePath - Path to the tex file
 * @returns {Object} Current version info
 */
function getCurrentTexVersion(filePath) {
    try {
        const row = db.prepare(`
            SELECT id, version_number, content, summary, source, created_at
            FROM tex_versions
            WHERE file_path = ? AND is_current = 1
        `).get(filePath);

        if (!row) {
            return null;
        }

        return {
            id: row.id,
            versionNumber: row.version_number,
            content: row.content,
            summary: row.summary,
            source: row.source,
            createdAt: row.created_at
        };
    } catch (error) {
        console.error('Error getting current tex version:', error);
        return null;
    }
}

/**
 * Switch to a different version (makes old version the new current without deleting anything)
 * @param {string} filePath - Path to the tex file
 * @param {number} versionNumber - Version to switch to
 * @param {string} summary - Summary for the "restored" version
 * @returns {Object} Result with new version info
 */
function switchTexVersion(filePath, versionNumber, summary = null) {
    try {
        // Get the content of the version we're switching to
        const oldVersion = db.prepare(`
            SELECT content, summary, source
            FROM tex_versions
            WHERE file_path = ? AND version_number = ?
        `).get(filePath, versionNumber);

        if (!oldVersion) {
            return { success: false, error: 'Version not found' };
        }

        // Create a new version with this content (preserves history)
        const restoreSummary = summary || `Restored from v${versionNumber}: ${oldVersion.summary || 'User version'}`;
        const result = saveTexVersion(filePath, oldVersion.content, restoreSummary, 'user');

        return result;
    } catch (error) {
        console.error('Error switching tex version:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Check if a file has any versions stored
 * @param {string} filePath - Path to the tex file
 * @returns {boolean} True if versions exist
 */
function hasTexVersions(filePath) {
    try {
        const row = db.prepare(`
            SELECT COUNT(*) as count
            FROM tex_versions
            WHERE file_path = ?
        `).get(filePath);

        return row.count > 0;
    } catch (error) {
        console.error('Error checking tex versions:', error);
        return false;
    }
}

/**
 * Get version count for a file
 * @param {string} filePath - Path to the tex file
 * @returns {number} Number of versions
 */
function getTexVersionCount(filePath) {
    try {
        const row = db.prepare(`
            SELECT COUNT(*) as count
            FROM tex_versions
            WHERE file_path = ?
        `).get(filePath);

        return row.count;
    } catch (error) {
        console.error('Error getting tex version count:', error);
        return 0;
    }
}

/**
 * Compare two versions and return diff info
 * @param {string} filePath - Path to the tex file
 * @param {number} version1 - First version number
 * @param {number} version2 - Second version number
 * @returns {Object} Diff information
 */
function compareTexVersions(filePath, version1, version2) {
    try {
        const v1 = db.prepare(`
            SELECT content, summary, source, created_at
            FROM tex_versions
            WHERE file_path = ? AND version_number = ?
        `).get(filePath, version1);

        const v2 = db.prepare(`
            SELECT content, summary, source, created_at
            FROM tex_versions
            WHERE file_path = ? AND version_number = ?
        `).get(filePath, version2);

        if (!v1 || !v2) {
            return { success: false, error: 'One or both versions not found' };
        }

        return {
            success: true,
            version1: {
                number: version1,
                content: v1.content,
                summary: v1.summary,
                source: v1.source,
                createdAt: v1.created_at
            },
            version2: {
                number: version2,
                content: v2.content,
                summary: v2.summary,
                source: v2.source,
                createdAt: v2.created_at
            }
        };
    } catch (error) {
        console.error('Error comparing tex versions:', error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// CLAUDE SLIDES METHODS
// ============================================================================

// Save Claude-generated slides
function saveClaudeSlides(subjectCode, title, question, content, sourceDocument = null, sourceType = 'tex', lectureNumber = null) {
    try {
        const stmt = db.prepare(`
            INSERT INTO claude_slides (subject_code, title, question, content, source_document, source_type, lecture_number)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(subjectCode, title, question, content, sourceDocument, sourceType, lectureNumber);
        return { success: true, id: result.lastInsertRowid };
    } catch (error) {
        console.error('Error saving Claude slides:', error);
        return { success: false, error: error.message };
    }
}

// Get all Claude slides for a subject
function getClaudeSlides(subjectCode) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM claude_slides
            WHERE subject_code = ?
            ORDER BY created_at DESC
        `);
        return stmt.all(subjectCode);
    } catch (error) {
        console.error('Error getting Claude slides:', error);
        return [];
    }
}

// Get all Claude slides across all subjects
function getAllClaudeSlides() {
    try {
        const stmt = db.prepare(`
            SELECT cs.*, s.name as subject_name, s.color as subject_color, s.icon as subject_icon
            FROM claude_slides cs
            LEFT JOIN subjects s ON cs.subject_code = s.code
            ORDER BY cs.created_at DESC
        `);
        return stmt.all();
    } catch (error) {
        console.error('Error getting all Claude slides:', error);
        return [];
    }
}

// Get a single Claude slide by ID
function getClaudeSlideById(id) {
    try {
        const stmt = db.prepare('SELECT * FROM claude_slides WHERE id = ?');
        return stmt.get(id);
    } catch (error) {
        console.error('Error getting Claude slide:', error);
        return null;
    }
}

// Delete a Claude slide
function deleteClaudeSlide(id) {
    try {
        const stmt = db.prepare('DELETE FROM claude_slides WHERE id = ?');
        stmt.run(id);
        return { success: true };
    } catch (error) {
        console.error('Error deleting Claude slide:', error);
        return { success: false, error: error.message };
    }
}

// Update Claude slide title
function updateClaudeSlideTitle(id, title) {
    try {
        const stmt = db.prepare('UPDATE claude_slides SET title = ? WHERE id = ?');
        stmt.run(title, id);
        return { success: true };
    } catch (error) {
        console.error('Error updating Claude slide title:', error);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// LATEX PROJECT FUNCTIONS
// ============================================================================

// Create a new LaTeX project
function createLatexProject(userId, name, description, projectPath, mainFile = 'main.tex', compiler = 'pdflatex') {
    try {
        const stmt = db.prepare(`
            INSERT INTO latex_projects (user_id, name, description, path, main_file, compiler)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(userId, name, description, projectPath, mainFile, compiler);
        return { success: true, projectId: result.lastInsertRowid };
    } catch (error) {
        if (error.message.includes('UNIQUE constraint')) {
            return { success: false, error: 'Project path already exists' };
        }
        console.error('Error creating LaTeX project:', error);
        return { success: false, error: error.message };
    }
}

// Get all LaTeX projects (optionally filtered by user)
function getLatexProjects(userId = null) {
    try {
        if (userId) {
            const stmt = db.prepare(`
                SELECT * FROM latex_projects
                WHERE user_id = ?
                ORDER BY updated_at DESC
            `);
            return stmt.all(userId);
        } else {
            // Return all projects from all users
            const stmt = db.prepare(`
                SELECT * FROM latex_projects
                ORDER BY user_id, updated_at DESC
            `);
            return stmt.all();
        }
    } catch (error) {
        console.error('Error getting LaTeX projects:', error);
        return [];
    }
}

// Get a single LaTeX project by ID
function getLatexProject(projectId) {
    try {
        const stmt = db.prepare('SELECT * FROM latex_projects WHERE id = ?');
        return stmt.get(projectId);
    } catch (error) {
        console.error('Error getting LaTeX project:', error);
        return null;
    }
}

// Get a LaTeX project by path
function getLatexProjectByPath(projectPath) {
    try {
        const stmt = db.prepare('SELECT * FROM latex_projects WHERE path = ?');
        return stmt.get(projectPath);
    } catch (error) {
        console.error('Error getting LaTeX project by path:', error);
        return null;
    }
}

// Update a LaTeX project
function updateLatexProject(projectId, updates) {
    try {
        const allowedFields = ['name', 'description', 'main_file', 'compiler', 'auto_compile'];
        const setClauses = [];
        const values = [];

        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                setClauses.push(`${key} = ?`);
                values.push(value);
            }
        }

        if (setClauses.length === 0) {
            return { success: false, error: 'No valid fields to update' };
        }

        setClauses.push('updated_at = ?');
        values.push(Date.now());
        values.push(projectId);

        const stmt = db.prepare(`UPDATE latex_projects SET ${setClauses.join(', ')} WHERE id = ?`);
        stmt.run(...values);
        return { success: true };
    } catch (error) {
        console.error('Error updating LaTeX project:', error);
        return { success: false, error: error.message };
    }
}

// Delete a LaTeX project
function deleteLatexProject(projectId) {
    try {
        const stmt = db.prepare('DELETE FROM latex_projects WHERE id = ?');
        stmt.run(projectId);
        return { success: true };
    } catch (error) {
        console.error('Error deleting LaTeX project:', error);
        return { success: false, error: error.message };
    }
}

// Get project files
function getProjectFiles(projectId) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM project_files
            WHERE project_id = ?
            ORDER BY file_path
        `);
        return stmt.all(projectId);
    } catch (error) {
        console.error('Error getting project files:', error);
        return [];
    }
}

// Add a file to project
function addProjectFile(projectId, filePath, fileType = 'tex', isMain = 0) {
    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO project_files (project_id, file_path, file_type, is_main, last_modified)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(projectId, filePath, fileType, isMain, Date.now());
        return { success: true };
    } catch (error) {
        console.error('Error adding project file:', error);
        return { success: false, error: error.message };
    }
}

// Remove a file from project
function removeProjectFile(projectId, filePath) {
    try {
        const stmt = db.prepare('DELETE FROM project_files WHERE project_id = ? AND file_path = ?');
        stmt.run(projectId, filePath);
        return { success: true };
    } catch (error) {
        console.error('Error removing project file:', error);
        return { success: false, error: error.message };
    }
}

// Update project file modification time
function updateProjectFileModified(projectId, filePath) {
    try {
        const stmt = db.prepare(`
            UPDATE project_files SET last_modified = ?
            WHERE project_id = ? AND file_path = ?
        `);
        stmt.run(Date.now(), projectId, filePath);
        return { success: true };
    } catch (error) {
        console.error('Error updating project file:', error);
        return { success: false, error: error.message };
    }
}

// Add YouTube reference to project
function addProjectYoutubeRef(projectId, filePath, videoId, videoTitle, timestampSeconds = 0, note = '') {
    try {
        const stmt = db.prepare(`
            INSERT INTO project_youtube_refs (project_id, file_path, video_id, video_title, timestamp_seconds, note)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(projectId, filePath, videoId, videoTitle, timestampSeconds, note);
        return { success: true, refId: result.lastInsertRowid };
    } catch (error) {
        console.error('Error adding YouTube reference:', error);
        return { success: false, error: error.message };
    }
}

// Get YouTube references for project
function getProjectYoutubeRefs(projectId) {
    try {
        const stmt = db.prepare(`
            SELECT * FROM project_youtube_refs
            WHERE project_id = ?
            ORDER BY created_at DESC
        `);
        return stmt.all(projectId);
    } catch (error) {
        console.error('Error getting YouTube references:', error);
        return [];
    }
}

// Delete YouTube reference
function deleteProjectYoutubeRef(refId) {
    try {
        const stmt = db.prepare('DELETE FROM project_youtube_refs WHERE id = ?');
        stmt.run(refId);
        return { success: true };
    } catch (error) {
        console.error('Error deleting YouTube reference:', error);
        return { success: false, error: error.message };
    }
}

// Save project version snapshot
function saveProjectVersion(projectId, versionNumber, snapshotData, summary, source = 'user') {
    try {
        const stmt = db.prepare(`
            INSERT INTO project_versions (project_id, version_number, snapshot_data, summary, source)
            VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(projectId, versionNumber, JSON.stringify(snapshotData), summary, source);
        return { success: true, versionId: result.lastInsertRowid };
    } catch (error) {
        console.error('Error saving project version:', error);
        return { success: false, error: error.message };
    }
}

// Get project versions
function getProjectVersions(projectId) {
    try {
        const stmt = db.prepare(`
            SELECT id, project_id, version_number, summary, source, created_at
            FROM project_versions
            WHERE project_id = ?
            ORDER BY version_number DESC
        `);
        return stmt.all(projectId);
    } catch (error) {
        console.error('Error getting project versions:', error);
        return [];
    }
}

// Get specific project version data
function getProjectVersionData(versionId) {
    try {
        const stmt = db.prepare('SELECT * FROM project_versions WHERE id = ?');
        const row = stmt.get(versionId);
        if (row && row.snapshot_data) {
            row.snapshot_data = JSON.parse(row.snapshot_data);
        }
        return row;
    } catch (error) {
        console.error('Error getting project version data:', error);
        return null;
    }
}

// Get next version number for project
function getNextProjectVersionNumber(projectId) {
    try {
        const stmt = db.prepare('SELECT MAX(version_number) as max_version FROM project_versions WHERE project_id = ?');
        const result = stmt.get(projectId);
        return (result.max_version || 0) + 1;
    } catch (error) {
        console.error('Error getting next version number:', error);
        return 1;
    }
}

module.exports = {
    db,
    addToHistory,
    getHistory,
    clearHistory,
    deleteHistoryItem,
    cleanupOldHistory,
    saveSplitCompanion,
    getSplitCompanion,
    getAllSplitCompanions,
    setPreference,
    getPreference,
    getAllPreferences,
    getStatistics,
    exportData,
    // V2 Multi-Subject Methods
    getSubjects,
    createSubject,
    updateSubject,
    deleteSubject,
    getCurrentSubject,
    setCurrentSubject,
    // Custom Categories
    addCustomCategory,
    getCustomCategories,
    renameCustomCategory,
    deleteCustomCategory,
    // Chat History (Ask Claude)
    saveChatHistory,
    getChatHistory,
    clearChatHistory,
    // TeX Version Control
    saveTexVersion,
    getTexVersions,
    getTexVersionContent,
    getCurrentTexVersion,
    switchTexVersion,
    hasTexVersions,
    getTexVersionCount,
    compareTexVersions,
    // Claude Slides
    saveClaudeSlides,
    getClaudeSlides,
    getAllClaudeSlides,
    getClaudeSlideById,
    deleteClaudeSlide,
    updateClaudeSlideTitle,
    // LaTeX Projects
    createLatexProject,
    getLatexProjects,
    getLatexProject,
    getLatexProjectByPath,
    updateLatexProject,
    deleteLatexProject,
    getProjectFiles,
    addProjectFile,
    removeProjectFile,
    updateProjectFileModified,
    addProjectYoutubeRef,
    getProjectYoutubeRefs,
    deleteProjectYoutubeRef,
    saveProjectVersion,
    getProjectVersions,
    getProjectVersionData,
    getNextProjectVersionNumber
};

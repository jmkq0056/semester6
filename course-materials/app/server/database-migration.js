const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'pdf-viewer.db');
const SCHEMA_PATH = path.join(__dirname, 'database-schema-v2.sql');

class DatabaseMigration {
    constructor() {
        this.db = null;
    }

    connect() {
        try {
            this.db = new Database(DB_PATH);
            console.log('✅ Connected to database');
        } catch (err) {
            console.error('❌ Failed to connect to database:', err);
            throw err;
        }
    }

    runQuery(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.run(...params);
        } catch (err) {
            throw err;
        }
    }

    getAll(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(...params);
        } catch (err) {
            throw err;
        }
    }

    get(sql, params = []) {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.get(...params);
        } catch (err) {
            throw err;
        }
    }

    tableExists(tableName) {
        const result = this.getAll(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
            [tableName]
        );
        return result.length > 0;
    }

    createNewSchema() {
        console.log('\n📋 Creating new schema...');

        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

        // Remove comments and split into statements more intelligently
        const cleanedSchema = schema
            .split('\n')
            .filter(line => !line.trim().startsWith('--'))
            .join('\n');

        // Split by semicolon but handle triggers properly
        const statements = [];
        let currentStatement = '';
        let inTrigger = false;

        for (const line of cleanedSchema.split('\n')) {
            const trimmed = line.trim();

            if (trimmed.toUpperCase().includes('CREATE TRIGGER')) {
                inTrigger = true;
            }

            currentStatement += line + '\n';

            if (trimmed.endsWith(';')) {
                if (inTrigger && trimmed === 'END;') {
                    inTrigger = false;
                    statements.push(currentStatement.trim());
                    currentStatement = '';
                } else if (!inTrigger) {
                    statements.push(currentStatement.trim());
                    currentStatement = '';
                }
            }
        }

        for (const statement of statements) {
            if (statement.length > 0) {
                try {
                    this.db.exec(statement);
                } catch (err) {
                    console.error(`❌ Error executing statement: ${err.message}`);
                    console.error(`Statement: ${statement.substring(0, 100)}...`);
                }
            }
        }

        console.log('✅ New schema created');
    }

    createDefaultSubject() {
        console.log('\n📚 Creating default subject: Machine Intelligence...');

        const exists = this.getAll(
            `SELECT * FROM subjects WHERE code = 'MACHINE-INT'`
        );

        if (exists.length === 0) {
            this.runQuery(`
                INSERT INTO subjects (name, code, semester, color, icon)
                VALUES (?, ?, ?, ?, ?)
            `, [
                'Machine Intelligence',
                'MACHINE-INT',
                'Fall 2025',
                '#007AFF',
                'fa-brain'
            ]);
            console.log('✅ Default subject created');
        } else {
            console.log('ℹ️  Default subject already exists');
        }

        return this.get(`SELECT id FROM subjects WHERE code = 'MACHINE-INT'`).id;
    }

    migrateHistoryData(subjectId) {
        console.log('\n🔄 Migrating history data...');

        const oldHistoryExists = this.tableExists('history');

        if (!oldHistoryExists) {
            console.log('ℹ️  No old history table found, skipping migration');
            return;
        }

        const oldHistory = this.getAll(`SELECT * FROM history ORDER BY timestamp DESC`);

        console.log(`Found ${oldHistory.length} history entries to migrate`);

        for (const entry of oldHistory) {
            try {
                this.runQuery(`
                    INSERT INTO history_v2 (subject_id, title, filepath, category, was_split_view, accessed_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    subjectId,
                    entry.title,
                    entry.path,
                    entry.category || 'Unknown',
                    entry.was_split_view || 0,
                    entry.timestamp
                ]);
            } catch (err) {
                console.error(`Warning: Could not migrate history entry: ${entry.title} - ${err.message}`);
            }
        }

        console.log('✅ History data migrated');
    }

    setDefaultPreferences() {
        console.log('\n⚙️  Setting default preferences...');

        const defaults = [
            { key: 'currentSubject', value: 'MACHINE-INT' },
            { key: 'compactMode', value: 'true' },
            { key: 'lectureColors', value: 'true' },
            { key: 'fastSearchEnabled', value: 'true' }
        ];

        for (const pref of defaults) {
            try {
                this.db.exec(`
                    INSERT OR REPLACE INTO preferences (key, value, updated_at)
                    VALUES ('${pref.key}', '${pref.value}', CURRENT_TIMESTAMP)
                `);
            } catch (err) {
                console.error(`Warning: Could not set preference ${pref.key}`);
            }
        }

        console.log('✅ Preferences set');
    }

    backupDatabase() {
        console.log('\n💾 Creating database backup...');

        const backupPath = path.join(__dirname, `pdf-viewer-backup-${Date.now()}.db`);

        try {
            fs.copyFileSync(DB_PATH, backupPath);
            console.log(`✅ Backup created: ${backupPath}`);
            return backupPath;
        } catch (err) {
            console.error('❌ Backup failed:', err);
            throw err;
        }
    }

    migrate() {
        try {
            console.log('🚀 Starting database migration...\n');

            // Backup first
            this.backupDatabase();

            // Connect to database
            this.connect();

            // Create new schema
            this.createNewSchema();

            // Create default subject
            const subjectId = this.createDefaultSubject();

            // Migrate old history
            this.migrateHistoryData(subjectId);

            // Set preferences
            this.setDefaultPreferences();

            console.log('\n✅ Migration completed successfully!\n');

        } catch (err) {
            console.error('\n❌ Migration failed:', err);
            throw err;
        } finally {
            if (this.db) {
                this.db.close();
                console.log('Database connection closed');
            }
        }
    }
}

// Run migration if called directly
if (require.main === module) {
    const migration = new DatabaseMigration();
    try {
        migration.migrate();
        console.log('Migration complete!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

module.exports = DatabaseMigration;

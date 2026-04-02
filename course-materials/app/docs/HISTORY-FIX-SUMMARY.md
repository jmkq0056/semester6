# History System Fix - December 4, 2025

## Problem Identified

The recent history feature was completely broken due to an **incorrect database schema**:

### Root Cause
The `history` table had a UNIQUE constraint on `path` alone:
```sql
path TEXT NOT NULL UNIQUE
```

Instead of the correct multi-column constraint:
```sql
UNIQUE(subject_code, path)
```

### Impact
- ❌ Same PDF viewed in different subjects caused duplicate key errors
- ❌ History didn't work across multiple courses
- ❌ SQLite threw "UNIQUE constraint failed" errors
- ❌ Users couldn't track PDF views per subject

## Solution Implemented

### 1. Database Schema Fixed
```sql
CREATE TABLE history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_code TEXT NOT NULL,          -- Fixed: NOT NULL
    title TEXT NOT NULL,
    path TEXT NOT NULL,
    category TEXT,
    was_split_view INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL,
    access_count INTEGER DEFAULT 1,
    UNIQUE(subject_code, path)           -- Fixed: Composite UNIQUE
);
```

### 2. Added Missing Index
```sql
CREATE INDEX idx_history_subject ON history(subject_code);
```

### 3. Improved Migration Logic
- Added automatic schema detection
- Migrates old data when incorrect schema detected
- Preserves existing history with default subject_code
- Logs migration status with emoji indicators

### 4. Code Updates
**File: `server/database.js`**
- Fixed table creation with correct schema
- Enhanced migration code with better error handling
- Added comprehensive schema validation

## Testing Results

✅ **Test 1:** Add history to ASE subject
```bash
curl -X POST /api/history -d '{"title":"Test","path":"test.pdf"}'
# Result: SUCCESS - Added to ASE
```

✅ **Test 2:** Add same path to MACHINE-INT subject
```bash
curl -X POST /api/history -d '{"title":"Test","path":"test.pdf"}'
# Result: SUCCESS - No duplicate key error!
```

✅ **Test 3:** Verify database
```bash
SELECT subject_code, path FROM history;
# Result:
# ASE|test.pdf
# MACHINE-INT|test.pdf
```

## Features Now Working

✅ Recent history per subject
✅ Same PDF can be tracked across subjects
✅ No more duplicate key errors
✅ Proper subject isolation
✅ Access count tracking per subject
✅ Automatic old history cleanup (60 days)

## Files Modified

1. `/server/database.js` - Fixed schema and migration
2. `/data/pdf-viewer.db` - Database structure corrected

## Backup

All changes backed up to:
- `data/pdf-viewer-backup-before-fix-[timestamp].db`

## Migration

The fix automatically migrates on next server start:
- Detects incorrect schema
- Backs up existing data
- Recreates table with correct structure
- Restores data with subject_code

## Status: ✅ FIXED & TESTED

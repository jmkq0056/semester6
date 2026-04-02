# 🚀 COMPREHENSIVE REFACTORING PLAN

## Current Issues to Fix

### 1. File Path Display
- **Problem**: Full paths showing, taking too much space
- **Solution**:
  - Show only filename by default
  - Add expandable icon to show full path on hover/click
  - Truncate middle of path if needed: `notes/.../file.pdf`

### 2. File Categorization Issues
- **Files Not Properly Categorized**:
  - `Sheet Lec 6` → Should be "Exercises (No Solutions)" + Lecture 6
  - `Lec 2 Exc Blueprint` → Should be "Blueprint" + Lecture 2
  - `Lec 3 Exc Blueprint` → Should be "Blueprint" + Lecture 3
  - `Lec 4 Exc Blueprint` → Should be "Blueprint" + Lecture 4
  - `Lec 2 Teacher Methodology Cheatsheet` → Should be "Teachers Method" + Lecture 2
  - `Lec 3 Teacher Methodology Guide` → Should be "Teachers Method" + Lecture 3

### 3. Smart Search Rebranding
- **Current**: "Smart Search" with AI-looking interface
- **New**: "⚡ Fast Search" with bolt icon
- Remove any AI/ML branding
- Keep it simple and functional

## Major Refactoring: Multi-Subject Support

### Architecture Changes

#### 1. Directory Structure
```
/Documents/
  /course-materials/          ← NEW ROOT
    /machine-intelligence/
      /lecture-slides/
      /notes/
      /exercises/
      /blueprint/
      /teachers-method/
    /data-structures/         ← NEW SUBJECT
    /algorithms/              ← NEW SUBJECT
    /database-systems/        ← NEW SUBJECT
```

#### 2. Database Schema Enhancement
```sql
-- NEW: Subjects table
CREATE TABLE subjects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    semester TEXT,
    color TEXT,
    icon TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NEW: Files table (replaces current history-centric approach)
CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    subject_id INTEGER,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    category TEXT,  -- notes, slides, exercises, blueprint, teachers-method
    lecture_number INTEGER,
    file_type TEXT, -- PDF, DOCX, etc.
    upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP,
    FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

-- ENHANCED: History table
CREATE TABLE history (
    id INTEGER PRIMARY KEY,
    file_id INTEGER,
    subject_id INTEGER,
    accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    page_number INTEGER,
    was_split_view BOOLEAN,
    FOREIGN KEY (file_id) REFERENCES files(id),
    FOREIGN KEY (subject_id) REFERENCES subjects(id)
);

-- NEW: File metadata for search
CREATE TABLE file_metadata (
    id INTEGER PRIMARY KEY,
    file_id INTEGER,
    page_number INTEGER,
    content_text TEXT,  -- For full-text search
    FOREIGN KEY (file_id) REFERENCES files(id)
);
```

#### 3. UI Changes

##### New Subject Selector (Top Bar)
```
┌─────────────────────────────────────────────────┐
│ 📚 [Machine Intelligence ▼] [⚡ Fast Search]   │
│                                                 │
│ Subjects:                                       │
│ • Machine Intelligence (Current)                │
│ • Data Structures                               │
│ • Algorithms                                    │
│ + Add New Subject                               │
└─────────────────────────────────────────────────┘
```

##### File Upload & Management Form
```
┌─────────────────────────────────────────────────┐
│ Upload File                                     │
│                                                 │
│ Subject: [Machine Intelligence ▼]              │
│ Category: [Lecture Notes ▼]                    │
│ Lecture #: [5]                                  │
│ File: [Choose File] selected-file.pdf          │
│                                                 │
│ [Cancel] [Upload]                               │
└─────────────────────────────────────────────────┘
```

##### Compact Path Display
```
Before:
├─ teachers-method/lec-2-teacher-methodology-cheatsheet.pdf

After:
├─ lec-2-teacher-methodology... [📂] ← Click to expand
   └─ teachers-method/lec-2-teacher-methodology-cheatsheet.pdf
```

#### 4. Fast Search Panel (Renamed)
```
┌─────────────────────────────────────────────────┐
│ ⚡ FAST SEARCH                                  │
│                                                 │
│ [Search across all subjects...]                │
│                                                 │
│ ☐ 📄 Handouts Only     [↻ Re-index]           │
│                                                 │
│ Results:                                        │
│ 🔖 Machine Intelligence > Lec 5... 95%         │
│    p3 92%  p12 88%  p18 76%                    │
│                                                 │
│ 🔖 Data Structures > Trees... 87%              │
│    p5 87%  p8 82%  p15 71%                     │
└─────────────────────────────────────────────────┘
```

### Implementation Steps

#### Phase 1: Fix Current Issues (Quick Wins)
1. ✅ Fix file categorization logic
2. ✅ Compact path display with expand option
3. ✅ Rename "Smart Search" to "⚡ Fast Search"
4. ✅ Remove AI branding

#### Phase 2: Database Migration
1. ✅ Create new database schema
2. ✅ Migrate existing data to new structure
3. ✅ Update all queries to use new schema
4. ✅ Test data integrity

#### Phase 3: Multi-Subject Support
1. ✅ Add subject management UI
2. ✅ Add subject selector dropdown
3. ✅ Update sidebar to filter by selected subject
4. ✅ Update all file operations to include subject context

#### Phase 4: File Upload System
1. ✅ Create upload form UI
2. ✅ Add file categorization form
3. ✅ Implement file upload API endpoint
4. ✅ Add file organization logic
5. ✅ Update search index on upload

#### Phase 5: Navigation Enhancement
1. ✅ Add subject switcher in header
2. ✅ Add "Manage Subjects" page
3. ✅ Add "Upload Files" modal
4. ✅ Add file management (delete, recategorize)

### File Changes Required

```
NEW FILES:
├── database-migration.js      ← Migration script
├── subject-manager.js         ← Subject CRUD operations
├── file-upload.js             ← Upload handling
├── multi-subject-ui.js        ← Subject UI components
├── manage-subjects.html       ← Subject management page
└── upload-modal.html          ← Upload form component

MODIFIED FILES:
├── server.js                  ← New API endpoints
├── database.js                ← Schema updates
├── index.html                 ← Subject selector, upload button
├── script.js                  ← Subject filtering logic
├── styles.css                 ← New UI components
├── pdf-search-ui.js           ← Rename to Fast Search
└── pdf-search-engine-advanced.js  ← Multi-subject indexing
```

### API Endpoints to Add

```javascript
// Subject Management
POST   /api/subjects              ← Create subject
GET    /api/subjects              ← List all subjects
PUT    /api/subjects/:id          ← Update subject
DELETE /api/subjects/:id          ← Delete subject

// File Management
POST   /api/files/upload          ← Upload file
GET    /api/files?subject_id=X    ← List files by subject
PUT    /api/files/:id             ← Update file metadata
DELETE /api/files/:id             ← Delete file

// Search (Enhanced)
GET    /api/search?q=X&subject_id=Y  ← Search with subject filter
POST   /api/search/reindex        ← Re-index all subjects
```

### Configuration File

```json
{
  "appName": "Course Materials Hub",
  "rootDirectory": "/Documents/course-materials",
  "defaultSubject": "machine-intelligence",
  "supportedFileTypes": [".pdf", ".docx", ".pptx"],
  "categories": [
    "Lecture Notes",
    "Lecture Slides",
    "Exercises",
    "Exercises (No Solutions)",
    "Blueprint",
    "Teachers Method"
  ],
  "searchSettings": {
    "maxResults": 50,
    "previewLength": 200,
    "indexPageContent": true
  }
}
```

## Visual Changes Summary

### Before (Smart Search)
```
┌────────────────────────────┐
│ 🤖 SMART SEARCH           │
│ AI-Powered Document Search │
└────────────────────────────┘
```

### After (Fast Search)
```
┌────────────────────────────┐
│ ⚡ FAST SEARCH            │
│ Quick document lookup      │
└────────────────────────────┘
```

### Before (File Paths)
```
teachers-method/lec-3-teacher-methodology-guide.pdf
```

### After (Compact Paths)
```
lec-3-teacher-method... [📂]
```

### New Subject Selector
```
┌──────────────────────────────────────────┐
│ 📚 Machine Intelligence ▼  ⚡ [Upload]  │
└──────────────────────────────────────────┘
```

## Testing Checklist

- [ ] File categorization works correctly
- [ ] Path display is compact and expandable
- [ ] Fast Search works as before
- [ ] Subject switching works
- [ ] File upload and categorization works
- [ ] Search works across all subjects
- [ ] History tracks subject context
- [ ] Lecture colors work per subject
- [ ] All existing features still work
- [ ] Database migration successful

## Rollback Plan

1. Git commit before starting
2. Backup database file
3. Keep old schema in migration script
4. Document all API changes
5. Test with copy of data first

## Estimated Changes

- **Lines of Code**: ~2000-3000 new/modified
- **Database Tables**: 3 new, 1 modified
- **API Endpoints**: 8 new
- **UI Components**: 5 new
- **Time Estimate**: Comprehensive refactoring

---

## ⚠️ IMPORTANT: Review This Plan

Please review this plan carefully and confirm:

1. ✅ Are these the changes you want?
2. ✅ Is the scope correct?
3. ✅ Should I proceed with all phases?
4. ✅ Any modifications needed?

**Once you approve, I will:**
1. Create a git commit with current state
2. Start Phase 1 (Quick wins)
3. Continue through all phases
4. Not stop until complete

Type "APPROVED" to begin, or suggest changes.

# Directory Restructure Plan

## Current Structure (BROKEN):
```
/
├── notes/
├── lecture slides/
├── exercises/
├── blueprint/
├── teachers-method/
└── ... (all for Machine Intelligence only)
```

## New Structure (WORKING):
```
/
├── subjects/
│   ├── MACHINE-INT/
│   │   ├── notes/
│   │   ├── slides/
│   │   ├── exercises/
│   │   ├── exercises-no-solutions/
│   │   ├── blueprint/
│   │   └── teachers-method/
│   ├── DATA-STRUCTURES/
│   │   ├── notes/
│   │   ├── slides/
│   │   └── ...
│   └── ... (other subjects)
└── server.js (updated to scan subjects/{code}/)
```

## Changes Needed:

### 1. Database Changes:
- Add 'base_directory' column to subjects table
- Store subject folder path

### 2. File System:
- Create subjects/ directory
- Create subjects/MACHINE-INT/
- Move existing files to subjects/MACHINE-INT/{category}/

### 3. Server.js Changes:
- Update scanDirectory() to take subject code parameter
- Scan subjects/{code}/ instead of root
- Abstract categorization logic

### 4. API Changes:
- GET /api/files?subject=CODE
- Upload to subjects/{code}/{category}/

### 5. Frontend Changes:
- Load files for current subject only
- Switch subject = reload with new subject's files

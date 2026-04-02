const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const db = require('./database');
const { exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { PDFDocument } = require('pdf-lib');

// LaTeX Projects routes
const latexProjectsRoutes = require('./routes/latex-projects');

const app = express();
const PORT = process.env.PORT || 3000;

// Base directories - server is now in server/ subfolder
const APP_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const SUBJECTS_DIR = path.join(APP_ROOT, 'subjects');
const DATA_DIR = path.join(APP_ROOT, 'data');
const LATEX_PROJECTS_DIR = path.join(APP_ROOT, 'latex-projects');

// Initialize LaTeX Projects routes
latexProjectsRoutes.initRoutes(db, LATEX_PROJECTS_DIR);

// Compilation lock to prevent race conditions
const compilationLocks = new Map(); // path -> { locked: boolean, queue: [] }

async function acquireCompileLock(texPath) {
    if (!compilationLocks.has(texPath)) {
        compilationLocks.set(texPath, { locked: false, queue: [] });
    }
    const lock = compilationLocks.get(texPath);

    if (!lock.locked) {
        lock.locked = true;
        return true;
    }

    // Wait for lock to be released (with timeout)
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            const idx = lock.queue.indexOf(resolve);
            if (idx > -1) lock.queue.splice(idx, 1);
            resolve(false);
        }, 30000); // 30s timeout

        lock.queue.push(() => {
            clearTimeout(timeout);
            lock.locked = true;
            resolve(true);
        });
    });
}

function releaseCompileLock(texPath) {
    const lock = compilationLocks.get(texPath);
    if (lock) {
        if (lock.queue.length > 0) {
            const next = lock.queue.shift();
            next();
        } else {
            lock.locked = false;
        }
    }
}

// Ensure directories exist
[SUBJECTS_DIR, DATA_DIR, LATEX_PROJECTS_DIR].forEach(dir => {
    if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
    }
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(DATA_DIR, 'uploads');
        if (!fsSync.existsSync(uploadDir)) {
            fsSync.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
            return cb(new Error('Only PDF files are allowed'));
        }
        cb(null, true);
    },
    limits: {
        fileSize: 50 * 1024 * 1024
    }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(PUBLIC_DIR));

// Serve subject files statically (allow dotfiles for .backups folder)
app.use('/subjects', express.static(SUBJECTS_DIR, { dotfiles: 'allow' }));

// Serve LaTeX projects files statically
app.use('/latex-projects', express.static(LATEX_PROJECTS_DIR, { dotfiles: 'allow' }));

// Mount LaTeX Projects API routes
app.use('/api/latex-projects', latexProjectsRoutes.router);

// Serve LaTeX Projects page
app.get('/latex', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'latex.html'));
});

// ============================================================================
// FILE PLACEMENT GUIDE - Loaded at startup for AI assistants and validation
// ============================================================================

const FILE_PLACEMENT_GUIDE_PATH = path.join(__dirname, '..', 'docs', 'FILE-PLACEMENT-GUIDE.md');

// Validate the guide exists at startup
if (fsSync.existsSync(FILE_PLACEMENT_GUIDE_PATH)) {
    console.log(`File placement guide loaded: ${FILE_PLACEMENT_GUIDE_PATH}`);
} else {
    console.warn('WARNING: FILE-PLACEMENT-GUIDE.md not found in app/docs/. File naming rules will not be available.');
}

// Serve the guide as an API endpoint (for AI assistants and the app)
app.get('/api/file-placement-guide', async (req, res) => {
    try {
        const content = await fs.readFile(FILE_PLACEMENT_GUIDE_PATH, 'utf-8');
        res.json({ success: true, content });
    } catch (error) {
        res.status(404).json({ success: false, error: 'FILE-PLACEMENT-GUIDE.md not found' });
    }
});

// Validate a filename against the guide's naming rules
app.post('/api/validate-filename', express.json(), (req, res) => {
    const { filename, category } = req.body;
    if (!filename) {
        return res.status(400).json({ success: false, error: 'filename is required' });
    }

    const errors = [];
    const name = filename.toLowerCase();

    if (category === 'slides' || name.includes('lec')) {
        // Lecture slide: must match lec{N}.pdf pattern
        if (!/(?:lec|lecture|l)[\s\-_]*\d+/i.test(filename)) {
            errors.push('Lecture slides should match pattern: lec{N}.pdf (e.g. lec01.pdf, lec-2-intro.pdf)');
        }
    }

    if (category === 'exercises' || name.includes('exercise')) {
        // Exercise: must have exercise number
        if (!/exercise[\s\-_]*\d+/i.test(filename)) {
            errors.push('Exercises should match pattern: exercise {N} solution.pdf (e.g. exercise 1 solution.pdf)');
        }
    }

    if (!name.endsWith('.pdf') && !name.endsWith('.tex')) {
        errors.push('Only .pdf and .tex files are supported by the scanner');
    }

    res.json({
        success: true,
        valid: errors.length === 0,
        errors,
        filename
    });
});

// ============================================================================
// FILE SCANNING - ABSTRACT FOR ANY SUBJECT
// ============================================================================

async function scanSubjectDirectory(subjectCode) {
    const subjectPath = path.join(SUBJECTS_DIR, subjectCode);

    if (!fsSync.existsSync(subjectPath)) {
        return [];
    }

    const files = await scanDirectory(subjectPath, subjectPath);

    // Prepend subjects/{code}/ to all paths for correct URL
    return files.map(file => ({
        ...file,
        path: `subjects/${subjectCode}/${file.path}`,
        directory: file.directory
    }));
}

async function scanDirectory(dirPath, baseDir = dirPath) {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        let files = [];

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            const relativePath = path.relative(baseDir, fullPath);

            if (entry.isDirectory()) {
                // Exclude hidden dirs, node_modules, and Python virtual env / pip package directories
                const excludedDirs = ['node_modules', 'venv', 'env', 'site-packages', '__pycache__', 'lib', 'lib64'];
                if (!entry.name.startsWith('.') && !excludedDirs.includes(entry.name)) {
                    const subFiles = await scanDirectory(fullPath, baseDir);
                    files = files.concat(subFiles);
                }
            } else if (entry.isFile() &&
                       (entry.name.toLowerCase().endsWith('.pdf') ||
                        entry.name.toLowerCase().endsWith('.tex'))) {
                const fileExtension = path.extname(entry.name).toLowerCase();
                files.push({
                    name: entry.name,
                    path: relativePath.replace(/\\/g, '/'),
                    fullPath: fullPath,
                    directory: path.dirname(relativePath).replace(/\\/g, '/'),
                    fileType: fileExtension === '.tex' ? 'tex' : 'pdf'
                });
            }
        }

        return files;
    } catch (error) {
        console.error(`Error scanning directory ${dirPath}:`, error);
        return [];
    }
}

// ============================================================================
// CATEGORIZATION - ABSTRACT BASED ON DIRECTORY STRUCTURE
// ============================================================================

function categorizePDFs(files, subjectCode) {
    const structure = {
        notes: {},
        slides: [],
        exercises: [],
        exercisesNoSolutions: [],
        blueprint: [],
        teachersMethod: [],
        customCategories: {}, // Track custom categories
        lectureFolders: {} // Track lecture folder names
    };

    // Get custom categories from database (returns array of objects with id, name, icon, color)
    const customCategories = db.getCustomCategories(subjectCode);
    const customCategoryIds = customCategories.map(cat => cat.id); // Extract just the IDs

    files.forEach(file => {
        const fileName = file.name.toLowerCase();
        const fileDir = file.directory.toLowerCase();
        const dirParts = file.directory.split('/');

        // Check if file is in a custom category (first directory level)
        const firstDirLevel = dirParts[0];
        if (customCategoryIds.includes(firstDirLevel)) {
            if (!structure.customCategories[firstDirLevel]) {
                structure.customCategories[firstDirLevel] = [];
            }
            structure.customCategories[firstDirLevel].push({
                title: formatFileName(file.name),
                path: file.path,
                category: firstDirLevel,
                lecture: extractLectureNumber(file.name),
                fileType: file.fileType || 'pdf'
            });
            return; // Skip standard categorization
        }

        // Categorize based on directory first (most reliable)
        if (fileDir.includes('teachers-method') || fileDir.includes('teacher-method')) {
            structure.teachersMethod.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Teachers Method',
                lecture: extractLectureNumber(file.name),
                fileType: file.fileType || 'pdf'
            });
        }
        else if (fileDir.includes('blueprint')) {
            structure.blueprint.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Blueprint',
                lecture: extractLectureNumber(file.name),
                fileType: file.fileType || 'pdf'
            });
        }
        else if (fileDir.includes('exercises-no-solutions') ||
                 (fileDir.includes('exercises') && (fileName.includes('sheet') || fileName.includes('no-sol')))) {
            structure.exercisesNoSolutions.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Exercises (No Solutions)',
                lecture: extractLectureNumber(file.name),
                fileType: file.fileType || 'pdf'
            });
        }
        else if (fileDir.includes('exercises') || fileDir.includes('exercise')) {
            structure.exercises.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Exercises',
                lecture: extractLectureNumber(file.name),
                fileType: file.fileType || 'pdf'
            });
        }
        else if (fileDir.includes('slides') || fileDir.includes('slide')) {
            structure.slides.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Lecture Slides',
                lecture: extractLectureNumber(file.name),
                fileType: file.fileType || 'pdf'
            });
        }
        else if (fileDir.includes('notes') || fileDir.includes('note')) {
            // Extract lecture folder name if in a subdirectory
            let lectureFolderName = null;
            for (let i = 0; i < dirParts.length; i++) {
                if (dirParts[i].toLowerCase() === 'notes' && i + 1 < dirParts.length) {
                    lectureFolderName = dirParts[i + 1];
                    break;
                }
            }

            const lectureNum = extractLectureNumber(file.name) || extractLectureNumber(lectureFolderName || '');

            if (lectureNum && lectureFolderName) {
                // Use folder name as key to preserve descriptive names
                if (!structure.notes[lectureFolderName]) {
                    structure.notes[lectureFolderName] = [];
                    structure.lectureFolders[lectureNum] = lectureFolderName;
                }
                structure.notes[lectureFolderName].push({
                    title: formatFileName(file.name),
                    path: file.path,
                    category: 'Lecture Notes',
                    lecture: lectureNum,
                    lectureFolderName: lectureFolderName,
                    fileType: file.fileType || 'pdf'
                });
            } else if (lectureNum && !lectureFolderName) {
                // File directly in notes/ with a lecture number in filename (e.g. L01-cheatsheet.pdf)
                const key = `lecture-${lectureNum}`;
                if (!structure.notes[key]) {
                    structure.notes[key] = [];
                }
                structure.notes[key].push({
                    title: formatFileName(file.name),
                    path: file.path,
                    category: 'Lecture Notes',
                    lecture: lectureNum,
                    fileType: file.fileType || 'pdf'
                });
            } else {
                // Other notes without lecture number
                if (!structure.notes['other']) {
                    structure.notes['other'] = [];
                }
                structure.notes['other'].push({
                    title: formatFileName(file.name),
                    path: file.path,
                    category: 'Other Notes',
                    lecture: null,
                    fileType: file.fileType || 'pdf'
                });
            }
        }
        else {
            // Uncategorized - try filename patterns
            if (fileName.includes('slide') || fileName.includes('handout')) {
                structure.slides.push({
                    title: formatFileName(file.name),
                    path: file.path,
                    category: 'Lecture Slides',
                    lecture: extractLectureNumber(file.name),
                    fileType: file.fileType || 'pdf'
                });
            } else {
                // Default to notes/other
                if (!structure.notes['other']) {
                    structure.notes['other'] = [];
                }
                structure.notes['other'].push({
                    title: formatFileName(file.name),
                    path: file.path,
                    category: 'Other Notes',
                    lecture: null,
                    fileType: file.fileType || 'pdf'
                });
            }
        }
    });

    // Sort all arrays using natural sort
    structure.slides.sort(naturalSort);
    structure.exercises.sort(naturalSort);
    structure.exercisesNoSolutions.sort(naturalSort);
    structure.blueprint.sort(naturalSort);
    structure.teachersMethod.sort(naturalSort);

    // Sort custom categories
    for (const categoryName in structure.customCategories) {
        structure.customCategories[categoryName].sort(naturalSort);
    }

    // Sort notes within each lecture folder
    for (const lectureName in structure.notes) {
        structure.notes[lectureName].sort(naturalSort);
    }

    return structure;
}

function formatFileName(fileName) {
    return fileName.replace(/\.(pdf|tex)$/i, '').replace(/[-_]/g, ' ');
}

function extractLectureNumber(fileName) {
    // Match lecture patterns: lec01, lecture-1, L3, etc.
    const lecMatch = fileName.match(/(?:lec|lecture|l)[\s-_]*(\d+)/i);
    if (lecMatch) return parseInt(lecMatch[1]);

    // Match exercise patterns: exercise 1, Exercise_2, Exercise1, etc.
    const exMatch = fileName.match(/exercise[\s-_]*(\d+)/i);
    if (exMatch) return parseInt(exMatch[1]);

    return null;
}

// Natural sort comparator for sorting files with numbers
function naturalSort(a, b) {
    // First try to sort by lecture number if both have one
    const aLecture = a.lecture;
    const bLecture = b.lecture;

    if (aLecture !== null && aLecture !== undefined && bLecture !== null && bLecture !== undefined) {
        if (aLecture !== bLecture) {
            return aLecture - bLecture;
        }
    }

    // If lecture numbers are the same or don't exist, sort by path/name naturally
    const aStr = a.path || a.name || '';
    const bStr = b.path || b.name || '';

    // Split strings into chunks of text and numbers
    const re = /(\d+)|(\D+)/g;
    const aParts = [];
    const bParts = [];

    let match;
    while ((match = re.exec(aStr)) !== null) {
        aParts.push(match[1] ? parseInt(match[1]) : match[2]);
    }

    re.lastIndex = 0;
    while ((match = re.exec(bStr)) !== null) {
        bParts.push(match[1] ? parseInt(match[1]) : match[2]);
    }

    // Compare parts
    const maxLength = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLength; i++) {
        const aPart = aParts[i];
        const bPart = bParts[i];

        if (aPart === undefined) return -1;
        if (bPart === undefined) return 1;

        if (typeof aPart === 'number' && typeof bPart === 'number') {
            if (aPart !== bPart) return aPart - bPart;
        } else {
            const comparison = String(aPart).localeCompare(String(bPart));
            if (comparison !== 0) return comparison;
        }
    }

    return 0;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Get current subject's files
app.get('/api/files', async (req, res) => {
    try {
        const currentSubject = db.getCurrentSubject();

        if (!currentSubject) {
            return res.json({
                success: false,
                error: 'No current subject set'
            });
        }

        const files = await scanSubjectDirectory(currentSubject.code);
        const structure = categorizePDFs(files, currentSubject.code);

        res.json({
            success: true,
            subject: currentSubject,
            structure: structure,
            totalFiles: files.length
        });
    } catch (error) {
        console.error('Error getting files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load files'
        });
    }
});

// Get files for specific subject
app.get('/api/files/:subjectCode', async (req, res) => {
    try {
        const { subjectCode } = req.params;
        const files = await scanSubjectDirectory(subjectCode);
        const structure = categorizePDFs(files, subjectCode);

        res.json({
            success: true,
            structure: structure,
            totalFiles: files.length
        });
    } catch (error) {
        console.error('Error getting files:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load files'
        });
    }
});

// ============================================================================
// CLAUDE-GENERATED SLIDES ENDPOINTS
// ============================================================================

// Get all Claude-generated slides organized by subject
app.get('/api/slides', (req, res) => {
    try {
        const allSlides = db.getAllClaudeSlides();
        const slidesBySubject = {};

        allSlides.forEach(slide => {
            if (!slidesBySubject[slide.subject_code]) {
                slidesBySubject[slide.subject_code] = {
                    subjectName: slide.subject_name || slide.subject_code,
                    subjectCode: slide.subject_code,
                    subjectColor: slide.subject_color || '#007AFF',
                    subjectIcon: slide.subject_icon || 'fa-book',
                    slides: []
                };
            }
            slidesBySubject[slide.subject_code].slides.push({
                id: slide.id,
                title: slide.title,
                question: slide.question,
                content: slide.content,
                sourceDocument: slide.source_document,
                sourceType: slide.source_type,
                lectureNumber: slide.lecture_number,
                createdAt: slide.created_at
            });
        });

        res.json({ success: true, slidesBySubject });
    } catch (error) {
        console.error('Error getting Claude slides:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get Claude slides for specific subject
app.get('/api/slides/:subjectCode', (req, res) => {
    try {
        const { subjectCode } = req.params;
        const slides = db.getClaudeSlides(subjectCode);

        res.json({
            success: true,
            subjectCode,
            slides: slides.map(s => ({
                id: s.id,
                title: s.title,
                question: s.question,
                content: s.content,
                sourceDocument: s.source_document,
                sourceType: s.source_type,
                lectureNumber: s.lecture_number,
                createdAt: s.created_at
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save Claude-generated slides
app.post('/api/slides/save', (req, res) => {
    try {
        const { subjectCode, title, question, content, sourceDocument, sourceType, lectureNumber } = req.body;

        if (!subjectCode || !title || !content) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: subjectCode, title, content'
            });
        }

        const result = db.saveClaudeSlides(
            subjectCode,
            title,
            question || '',
            content,
            sourceDocument || null,
            sourceType || 'tex',
            lectureNumber || null
        );

        res.json(result);
    } catch (error) {
        console.error('Error saving Claude slides:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get a single slide by ID
app.get('/api/slides/view/:id', (req, res) => {
    try {
        const slide = db.getClaudeSlideById(parseInt(req.params.id));
        if (!slide) {
            return res.status(404).json({ success: false, error: 'Slide not found' });
        }
        res.json({ success: true, slide });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete a Claude slide
app.delete('/api/slides/:id', (req, res) => {
    try {
        const result = db.deleteClaudeSlide(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update slide title
app.put('/api/slides/:id/title', (req, res) => {
    try {
        const { title } = req.body;
        if (!title) {
            return res.status(400).json({ success: false, error: 'Title is required' });
        }
        const result = db.updateClaudeSlideTitle(parseInt(req.params.id), title);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all subjects
app.get('/api/subjects', (req, res) => {
    const subjects = db.getSubjects();
    res.json({ success: true, subjects });
});

// Get current subject
app.get('/api/current-subject', (req, res) => {
    const subject = db.getCurrentSubject();
    res.json({ success: true, subject });
});

// Set current subject
app.post('/api/set-current-subject', (req, res) => {
    const { code } = req.body;
    const result = db.setCurrentSubject(code);
    res.json(result);
});

// Create new subject
app.post('/api/subjects', (req, res) => {
    const { name, code, semester, color, icon, custom_svg } = req.body;
    const result = db.createSubject(name, code, semester, color, icon, custom_svg);

    if (result.success) {
        // Create subject directory structure
        const subjectPath = path.join(SUBJECTS_DIR, code);
        const categories = ['notes', 'slides', 'exercises', 'exercises-no-solutions', 'blueprint', 'teachers-method'];

        try {
            fsSync.mkdirSync(subjectPath, { recursive: true });
            categories.forEach(cat => {
                fsSync.mkdirSync(path.join(subjectPath, cat), { recursive: true });
            });
        } catch (error) {
            console.error('Error creating subject directories:', error);
        }
    }

    res.json(result);
});

// Update subject
app.put('/api/subjects/:id', (req, res) => {
    const { id } = req.params;
    const result = db.updateSubject(parseInt(id), req.body);
    res.json(result);
});

// Delete subject
app.delete('/api/subjects/:id', (req, res) => {
    const { id } = req.params;
    const result = db.deleteSubject(parseInt(id));
    res.json(result);
});

// Get custom categories for a subject
app.get('/api/custom-categories/:subjectCode', (req, res) => {
    try {
        const { subjectCode } = req.params;
        const categories = db.getCustomCategories(subjectCode);
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Error getting custom categories:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Check if a file exists (used to avoid race conditions in PDF preview)
app.get('/api/file-exists/:filePath(*)', (req, res) => {
    try {
        const { filePath } = req.params;
        const fullPath = path.join(APP_ROOT, filePath);
        const resolvedPath = path.resolve(fullPath);

        // Security check - ensure path is within allowed directories
        if (!resolvedPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ exists: false, error: 'Access denied' });
        }

        const exists = fsSync.existsSync(resolvedPath);
        res.json({ exists });
    } catch (error) {
        console.error('Error checking file existence:', error);
        res.json({ exists: false });
    }
});

// Get all folders (categories) for a subject
app.get('/api/subject-folders/:subjectCode', async (req, res) => {
    try {
        const { subjectCode } = req.params;
        const subjectPath = path.join(SUBJECTS_DIR, subjectCode);

        if (!fsSync.existsSync(subjectPath)) {
            return res.status(404).json({ success: false, error: 'Subject not found' });
        }

        const entries = await fs.readdir(subjectPath, { withFileTypes: true });
        const folders = entries
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();

        res.json({ success: true, folders });
    } catch (error) {
        console.error('Error getting subject folders:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get all PDF and TEX files in a subject for @ autocomplete
app.get('/api/subject-files/:subjectCode', async (req, res) => {
    try {
        const { subjectCode } = req.params;
        const subjectPath = path.join(SUBJECTS_DIR, subjectCode);

        if (!fsSync.existsSync(subjectPath)) {
            return res.status(404).json({ success: false, error: 'Subject not found' });
        }

        const files = [];

        // Recursive function to find PDF and TEX files
        async function scanDir(dir, relativePath = '') {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

                if (entry.isDirectory()) {
                    // Skip backup folders
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    await scanDir(fullPath, relPath);
                } else if (entry.name.endsWith('.pdf') || entry.name.endsWith('.tex')) {
                    // Skip backup files
                    if (entry.name.includes('_BACKUP_')) continue;

                    files.push({
                        name: entry.name,
                        path: `subjects/${subjectCode}/${relPath}`,
                        folder: relativePath || subjectCode,
                        type: entry.name.endsWith('.pdf') ? 'pdf' : 'tex'
                    });
                }
            }
        }

        await scanDir(subjectPath);

        // Sort by name
        files.sort((a, b) => a.name.localeCompare(b.name));

        res.json(files);
    } catch (error) {
        console.error('Error getting subject files:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Add a custom category
app.post('/api/custom-categories', async (req, res) => {
    try {
        const { subjectCode, categoryName, categoryId, icon, color } = req.body;

        if (!subjectCode || !categoryName || !categoryId) {
            return res.status(400).json({
                success: false,
                error: 'Subject code, category name, and category ID are required'
            });
        }

        // Add to database with icon and color
        const result = db.addCustomCategory(
            subjectCode,
            categoryName,
            categoryId,
            icon || 'fa-folder',
            color || '#007AFF'
        );

        if (result.success) {
            // Create physical directory
            const categoryPath = path.join(SUBJECTS_DIR, subjectCode, categoryId);
            if (!fsSync.existsSync(categoryPath)) {
                await fs.mkdir(categoryPath, { recursive: true });
            }

            res.json({
                success: true,
                message: 'Custom category created successfully',
                category: {
                    id: categoryId,
                    name: categoryName,
                    icon: icon || 'fa-folder',
                    color: color || '#007AFF'
                }
            });
        } else {
            res.json(result);
        }
    } catch (error) {
        console.error('Error adding custom category:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rename a custom category
app.put('/api/custom-categories/:subjectCode/:categoryId/rename', async (req, res) => {
    try {
        const { subjectCode, categoryId } = req.params;
        const { newName, newCategoryId } = req.body;

        if (!newName || !newCategoryId) {
            return res.status(400).json({
                success: false,
                error: 'New name and ID are required'
            });
        }

        const oldCategoryPath = path.join(SUBJECTS_DIR, subjectCode, categoryId);
        const newCategoryPath = path.join(SUBJECTS_DIR, subjectCode, newCategoryId);

        // Check if old category exists
        if (!fsSync.existsSync(oldCategoryPath)) {
            return res.status(404).json({
                success: false,
                error: 'Category folder not found'
            });
        }

        // Check if new category already exists
        if (fsSync.existsSync(newCategoryPath) && categoryId !== newCategoryId) {
            return res.status(400).json({
                success: false,
                error: 'A category with this name already exists'
            });
        }

        // Rename the folder (this preserves all files)
        if (categoryId !== newCategoryId) {
            await fs.rename(oldCategoryPath, newCategoryPath);
            console.log(`Renamed category folder: ${categoryId} -> ${newCategoryId}`);
        }

        // Update database
        const result = db.renameCustomCategory(subjectCode, categoryId, newCategoryId);

        res.json({
            success: true,
            message: 'Category renamed successfully',
            newCategoryId: newCategoryId
        });
    } catch (error) {
        console.error('Error renaming custom category:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete a custom category
app.delete('/api/custom-categories/:subjectCode/:categoryId', async (req, res) => {
    try {
        const { subjectCode, categoryId } = req.params;

        // IMPORTANT: Move all files from this category to 'notes' folder (NEVER delete files)
        const categoryPath = path.join(SUBJECTS_DIR, subjectCode, categoryId);
        const notesPath = path.join(SUBJECTS_DIR, subjectCode, 'notes');

        // Ensure notes folder exists
        if (!fsSync.existsSync(notesPath)) {
            await fs.mkdir(notesPath, { recursive: true });
        }

        let movedCount = 0;
        if (fsSync.existsSync(categoryPath)) {
            const files = await fs.readdir(categoryPath);

            // Move all files to notes folder (preserve files!)
            for (const file of files) {
                if (file.endsWith('.pdf')) {
                    const oldPath = path.join(categoryPath, file);
                    const newPath = path.join(notesPath, file);

                    try {
                        // If file exists in destination, add suffix
                        let finalPath = newPath;
                        let counter = 1;
                        while (fsSync.existsSync(finalPath)) {
                            const baseName = file.replace('.pdf', '');
                            finalPath = path.join(notesPath, `${baseName}-${counter}.pdf`);
                            counter++;
                        }

                        await fs.rename(oldPath, finalPath);
                        movedCount++;
                        console.log(`Moved file: ${file} -> ${path.basename(finalPath)}`);
                    } catch (err) {
                        console.error(`Error moving file ${file}:`, err);
                    }
                }
            }

            // Delete the empty category folder
            try {
                await fs.rmdir(categoryPath, { recursive: true });
                console.log(`Deleted category folder: ${categoryId}`);
            } catch (err) {
                console.error(`Error deleting folder ${categoryId}:`, err);
            }
        }

        // Remove from database
        db.deleteCustomCategory(subjectCode, categoryId);

        res.json({
            success: true,
            message: `Category deleted successfully. ${movedCount} file(s) moved to notes.`,
            movedFiles: movedCount
        });
    } catch (error) {
        console.error('Error deleting custom category:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Sanitize filename: replace spaces with hyphens, remove special chars, preserve capitalization
function sanitizeFilename(filename) {
    // Remove .pdf extension temporarily
    let name = filename.replace(/\.pdf$/i, '');

    // Replace spaces and underscores with hyphens
    name = name.replace(/[\s_]+/g, '-');

    // Remove special characters except hyphens, numbers, and letters (keep case)
    name = name.replace(/[^a-zA-Z0-9-]/g, '');

    // Remove multiple consecutive hyphens
    name = name.replace(/-+/g, '-');

    // Remove leading/trailing hyphens
    name = name.replace(/^-+|-+$/g, '');

    return name + '.pdf';
}

// Upload PDF
app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const { subject_id, category, lecture_number, custom_name } = req.body;

        // Get subject code
        const subjects = db.getSubjects();
        const subject = subjects.find(s => s.id === parseInt(subject_id));

        if (!subject) {
            await fs.unlink(req.file.path);
            return res.status(400).json({ success: false, error: 'Subject not found' });
        }

        // Determine destination folder
        const standardCategories = {
            'notes': 'notes',
            'slides': 'slides',
            'exercises': 'exercises',
            'exercises-no-solutions': 'exercises-no-solutions',
            'blueprint': 'blueprint',
            'teachers-method': 'teachers-method'
        };

        // Use category directly (standard or custom)
        const categoryFolder = standardCategories[category] || category;

        // If it's a custom category (not in standard list), save it to database
        if (!standardCategories[category]) {
            // Format display name from ID (e.g., "my-notes" -> "My Notes")
            const categoryName = category
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
            db.addCustomCategory(subject.code, categoryName, category);
        }

        const destFolder = path.join(SUBJECTS_DIR, subject.code, categoryFolder);

        // Create destination folder if needed
        if (!fsSync.existsSync(destFolder)) {
            await fs.mkdir(destFolder, { recursive: true });
        }

        // Determine final filename and sanitize it
        let finalName = custom_name || req.file.originalname;

        // Smart filename processing
        let baseName = finalName.replace(/\.pdf$/i, '');

        // Extract exercise number from filename (e.g., Exercise2, exercise-3, ex_4)
        const exerciseMatch = baseName.match(/(?:exercise|ex)[- _]?(\d+)/i);
        const extractedExNum = exerciseMatch ? parseInt(exerciseMatch[1]) : null;

        // Detect if file has "solution" in name
        const hasSolution = /solution|sol/i.test(baseName);

        // Use provided lecture number or extracted exercise number
        const lecNum = lecture_number ? parseInt(lecture_number) : extractedExNum;

        if (lecNum && !isNaN(lecNum)) {
            // Remove all lecture/exercise/solution indicators and numbers
            baseName = baseName
                .replace(/^lec[- _]?\d*[- _]?/i, '')              // Remove lec-4
                .replace(/^lecture[- _]?\d*[- _]?/i, '')          // Remove lecture-4
                .replace(/^(?:exercise|ex)[- _]?\d*[- _]?/i, '')  // Remove exercise4, ex-4
                .replace(/^\d+[- _]+/, '')                         // Remove leading numbers
                .replace(/[- _]*(?:solution|sol)[- _]*/gi, '')    // Remove solution/sol
                .replace(/[- _]+/g, '-')                           // Normalize separators
                .replace(/^-+|-+$/g, '');                          // Trim separators

            // Capitalize "Exercise" if it appears anywhere in the filename
            baseName = baseName.replace(/\bexercise\b/gi, 'Exercise');

            // Determine the base name for this category
            let categoryBaseName = '';
            if (category === 'exercises' || category === 'exercises-no-solutions') {
                categoryBaseName = 'Exercise';
                if (category === 'exercises') {
                    categoryBaseName += '-Solution';
                }
            } else if (category === 'slides') {
                categoryBaseName = baseName || 'Slides';
            } else if (category === 'notes') {
                categoryBaseName = baseName || 'Notes';
            } else {
                // Capitalize first letter of category folder
                categoryBaseName = baseName || categoryFolder.charAt(0).toUpperCase() + categoryFolder.slice(1);
            }

            // If there's remaining text after cleanup, append it with proper capitalization
            if (baseName && baseName !== '-' && !['slides', 'notes', 'exercise', 'solution'].includes(baseName.toLowerCase())) {
                // Capitalize first letter of remaining text
                const capitalizedExtra = baseName.charAt(0).toUpperCase() + baseName.slice(1);

                if (category === 'exercises') {
                    categoryBaseName = 'Exercise-Solution-' + capitalizedExtra;
                } else if (category === 'exercises-no-solutions') {
                    categoryBaseName = 'Exercise-' + capitalizedExtra;
                } else {
                    categoryBaseName = capitalizedExtra;
                }
            }

            finalName = `lec-${lecNum}-${categoryBaseName}.pdf`;
        } else {
            // No lecture number: just clean up and use as-is
            baseName = baseName
                .replace(/lecture[- _]?(\d+)/gi, 'lec-$1')
                .replace(/[- _]+/g, '-')
                .replace(/^-+|-+$/g, '');

            // Capitalize "Exercise" if it appears anywhere in the filename
            baseName = baseName.replace(/\bexercise\b/gi, 'Exercise');

            finalName = baseName + '.pdf';
        }

        finalName = sanitizeFilename(finalName);

        const destPath = path.join(destFolder, finalName);

        // Move file
        await fs.rename(req.file.path, destPath);

        res.json({
            success: true,
            message: 'File uploaded successfully',
            file: {
                name: finalName,
                category: category,
                subject: subject.code
            }
        });

    } catch (error) {
        console.error('Upload error:', error);
        if (req.file && fsSync.existsSync(req.file.path)) {
            await fs.unlink(req.file.path);
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// File management operations
app.delete('/api/file', async (req, res) => {
    try {
        const { filepath } = req.body;

        if (!filepath) {
            return res.status(400).json({ success: false, error: 'File path is required' });
        }

        // Security: Ensure the path is within subjects directory
        const fullPath = path.join(APP_ROOT, filepath);
        const resolvedPath = path.resolve(fullPath);
        const subjectsPath = path.resolve(SUBJECTS_DIR);

        if (!resolvedPath.startsWith(subjectsPath)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Check if file exists
        if (!fsSync.existsSync(resolvedPath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Delete the file
        await fs.unlink(resolvedPath);

        // Remove from history
        db.deleteHistoryItem(filepath);

        res.json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/file/move', async (req, res) => {
    try {
        const { oldPath, newPath, newCategory } = req.body;

        if (!oldPath || !newPath) {
            return res.status(400).json({ success: false, error: 'Old and new paths are required' });
        }

        // Security: Ensure paths are within subjects directory
        const fullOldPath = path.join(APP_ROOT, oldPath);
        const resolvedOldPath = path.resolve(fullOldPath);
        const subjectsPath = path.resolve(SUBJECTS_DIR);

        if (!resolvedOldPath.startsWith(subjectsPath)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Check if source file exists
        if (!fsSync.existsSync(resolvedOldPath)) {
            return res.status(404).json({ success: false, error: 'Source file not found' });
        }

        // Construct new path
        const fullNewPath = path.join(APP_ROOT, newPath);
        const resolvedNewPath = path.resolve(fullNewPath);

        if (!resolvedNewPath.startsWith(subjectsPath)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Create destination directory if needed
        const newDir = path.dirname(resolvedNewPath);
        if (!fsSync.existsSync(newDir)) {
            await fs.mkdir(newDir, { recursive: true });
            console.log(`Created directory: ${newDir}`);
        }

        console.log('Moving file:', {
            from: resolvedOldPath,
            to: resolvedNewPath,
            category: newCategory
        });

        // Check if destination file already exists
        if (fsSync.existsSync(resolvedNewPath) && resolvedOldPath !== resolvedNewPath) {
            return res.status(400).json({
                success: false,
                error: 'A file with this name already exists in the destination folder'
            });
        }

        // Move/rename the file
        await fs.rename(resolvedOldPath, resolvedNewPath);
        console.log('File moved successfully');

        // Update history if it exists
        db.deleteHistoryItem(oldPath);

        res.json({
            success: true,
            message: 'File moved successfully',
            newPath: newPath
        });
    } catch (error) {
        console.error('Move error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// History operations
app.post('/api/history', (req, res) => {
    const { title, path, category, wasSplitView } = req.body;
    const result = db.addToHistory(title, path, category, wasSplitView);
    res.json(result);
});

app.get('/api/history', (req, res) => {
    const history = db.getHistory();
    res.json({ success: true, history });
});

app.delete('/api/history', (req, res) => {
    const result = db.clearHistory();
    res.json(result);
});

app.delete('/api/history/:path', (req, res) => {
    const result = db.deleteHistoryItem(decodeURIComponent(req.params.path));
    res.json(result);
});

// Split companion endpoints
app.post('/api/split-companion', (req, res) => {
    const { leftPath, rightPath } = req.body;
    if (!leftPath || !rightPath) {
        return res.status(400).json({ error: 'Both paths are required' });
    }
    const result = db.saveSplitCompanion(leftPath, rightPath);
    res.json(result);
});

app.get('/api/split-companion/:path', (req, res) => {
    const path = decodeURIComponent(req.params.path);
    const companion = db.getSplitCompanion(path);
    res.json({ companion });
});

// Preferences endpoints
app.get('/api/preferences', (req, res) => {
    const preferences = db.getAllPreferences();
    res.json(preferences);
});

app.get('/api/preferences/:key', (req, res) => {
    const value = db.getPreference(req.params.key);
    res.json({ value });
});

app.post('/api/preferences', (req, res) => {
    const { key, value } = req.body;
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }
    const result = db.setPreference(key, value);
    res.json(result);
});

// ============================================================================
// LATEX (.TEX) FILE OPERATIONS
// ============================================================================

// Check if pdflatex is available
app.get('/api/check-latex', async (req, res) => {
    try {
        // Try to find pdflatex
        const command = process.platform === 'win32' ? 'where pdflatex' : 'which pdflatex';
        await execAsync(command);
        res.json({ success: true, available: true });
    } catch (error) {
        res.json({ success: true, available: false });
    }
});

// Get LaTeX file content for editing
app.get('/api/tex-content/*', async (req, res) => {
    try {
        const filePath = req.params[0];
        const fullPath = path.join(APP_ROOT, filePath);
        const resolvedPath = path.resolve(fullPath);

        // Security check
        if (!resolvedPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(resolvedPath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');
        res.json({ success: true, content, path: filePath });
    } catch (error) {
        console.error('Error reading TeX file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get TeX file info (for URL validation and restoration)
app.get('/api/tex-info/*', async (req, res) => {
    try {
        const filePath = req.params[0];
        const fullPath = path.join(APP_ROOT, filePath);
        const resolvedPath = path.resolve(fullPath);

        // Security check
        if (!resolvedPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Check if file exists
        if (!fsSync.existsSync(resolvedPath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Extract file info
        const fileName = path.basename(filePath, '.tex');
        const dirPath = path.dirname(filePath);
        const parts = dirPath.split('/');

        // Expected path: subjects/{subjectCode}/{category}/...
        let category = '';
        let subjectCode = '';

        if (parts.length >= 3 && parts[0] === 'subjects') {
            subjectCode = parts[1];
            category = parts[2];

            // Format category name
            category = category
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        // Check for associated PDF
        const pdfPath = filePath.replace(/\.tex$/i, '.pdf');
        const pdfFullPath = path.join(APP_ROOT, pdfPath);
        const hasPdf = fsSync.existsSync(pdfFullPath);

        // Get file stats
        const stats = await fs.stat(resolvedPath);

        res.json({
            success: true,
            file: {
                path: filePath,
                name: fileName,
                category: category,
                subjectCode: subjectCode,
                hasPdf: hasPdf,
                pdfPath: hasPdf ? pdfPath : null,
                lastModified: stats.mtime,
                size: stats.size
            }
        });
    } catch (error) {
        console.error('Error getting TeX file info:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save LaTeX file content
app.put('/api/tex-content/*', async (req, res) => {
    try {
        const filePath = req.params[0];
        const { content } = req.body;
        const fullPath = path.join(APP_ROOT, filePath);
        const resolvedPath = path.resolve(fullPath);

        // Security check
        if (!resolvedPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await fs.writeFile(resolvedPath, content, 'utf-8');
        res.json({ success: true, message: 'File saved successfully' });
    } catch (error) {
        console.error('Error saving TeX file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create new LaTeX file
app.post('/api/create-tex', async (req, res) => {
    try {
        const { directory, filename } = req.body;

        if (!directory || !filename) {
            return res.status(400).json({ success: false, error: 'directory and filename are required' });
        }

        // Ensure filename ends with .tex
        const texFilename = filename.endsWith('.tex') ? filename : filename + '.tex';
        const fullPath = path.join(APP_ROOT, directory, texFilename);
        const resolvedPath = path.resolve(fullPath);

        // Security check
        if (!resolvedPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Check if file already exists
        if (fsSync.existsSync(resolvedPath)) {
            return res.status(409).json({ success: false, error: 'File already exists' });
        }

        // Parse directory to extract subject code and category
        // Expected format: subjects/{subjectCode}/{category}
        const dirParts = directory.split('/');
        if (dirParts.length >= 3 && dirParts[0] === 'subjects') {
            const subjectCode = dirParts[1];
            const categoryId = dirParts[2];

            // List of built-in categories that don't need to be registered
            const builtInCategories = ['notes', 'slides', 'exercises', 'exercises-no-solutions', 'blueprint', 'teachers-method'];

            // If this is not a built-in category, register it as a custom category
            if (!builtInCategories.includes(categoryId)) {
                // Check if category already exists in database
                const existingCategories = db.getCustomCategories(subjectCode);
                const categoryExists = existingCategories.some(cat => cat.id === categoryId);

                if (!categoryExists) {
                    // Format category name from ID (e.g., "my-notes" -> "My Notes")
                    const categoryName = categoryId
                        .split('-')
                        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                        .join(' ');

                    // Add to database with default icon and color
                    db.addCustomCategory(subjectCode, categoryName, categoryId, 'fa-folder', '#007AFF');
                    console.log(`Auto-registered new category: ${categoryName} (${categoryId}) for ${subjectCode}`);
                }
            }
        }

        // Create directory if it doesn't exist
        await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

        // Create new tex file with full cheatsheet template
        const displayTitle = filename.replace(/[-_]/g, ' ').replace(/\.tex$/i, '');
        const template = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{geometry}
\\usepackage{tcolorbox}
\\usepackage{xcolor}
\\usepackage{enumitem}
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{multirow}
\\usepackage{hyperref}

\\geometry{a4paper, margin=1in}

\\tcbuselibrary{skins,breakable}

% Define custom colors
\\definecolor{defcolor}{RGB}{0,51,102}
\\definecolor{excolor}{RGB}{0,102,51}
\\definecolor{notecolor}{RGB}{102,51,0}
\\definecolor{warncolor}{RGB}{153,0,0}

% Definition box
\\newtcolorbox{definitionbox}[1][]{
    colback=defcolor!5,
    colframe=defcolor,
    fonttitle=\\bfseries,
    title=#1,
    breakable,
    enhanced jigsaw
}

% Example box
\\newtcolorbox{examplebox}[1][]{
    colback=excolor!5,
    colframe=excolor,
    fonttitle=\\bfseries,
    title=#1,
    breakable,
    enhanced jigsaw
}

% Note box
\\newtcolorbox{notebox}[1][]{
    colback=notecolor!5,
    colframe=notecolor,
    fonttitle=\\bfseries,
    title=#1,
    breakable,
    enhanced jigsaw
}

% Warning box
\\newtcolorbox{warningbox}[1][]{
    colback=warncolor!5,
    colframe=warncolor,
    fonttitle=\\bfseries,
    title=#1,
    breakable,
    enhanced jigsaw
}

\\title{\\textbf{${displayTitle}}}
\\author{}
\\date{Fall 2025}

\\begin{document}

\\maketitle

\\tableofcontents
\\newpage

\\section{TØR VI DET?}

\\begin{notebox}[Velkommen]
Dette dokument er klar til at blive udfyldt med indhold.

\\textbf{Tilgængelige bokse:}
\\begin{itemize}
    \\item \\texttt{definitionbox} -- Til definitioner og koncepter
    \\item \\texttt{examplebox} -- Til eksempler
    \\item \\texttt{notebox} -- Til noter og forklaringer
    \\item \\texttt{warningbox} -- Til advarsler og vigtige punkter
\\end{itemize}
\\end{notebox}

\\begin{definitionbox}[Eksempel Definition]
Her kan du skrive en definition.
\\end{definitionbox}

\\begin{examplebox}[Eksempel]
Her kan du vise et eksempel.
\\end{examplebox}

\\begin{warningbox}[Vigtigt!]
Her kan du fremhæve vigtige advarsler.
\\end{warningbox}

\\end{document}
`;

        await fs.writeFile(resolvedPath, template, 'utf-8');

        const relativePath = path.join(directory, texFilename).replace(/\\/g, '/');
        res.json({
            success: true,
            message: 'TeX file created successfully',
            path: relativePath,
            filename: texFilename
        });
    } catch (error) {
        console.error('Error creating TeX file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Compile LaTeX to PDF
app.post('/api/compile-tex', async (req, res) => {
    const { texPath, outputPath } = req.body;

    if (!texPath) {
        return res.status(400).json({ success: false, error: 'texPath is required' });
    }

    // Acquire compilation lock
    const gotLock = await acquireCompileLock(texPath);
    if (!gotLock) {
        return res.status(409).json({ success: false, error: 'Compilation in progress, please wait' });
    }

    try {
        const fullTexPath = path.join(APP_ROOT, texPath);
        const resolvedTexPath = path.resolve(fullTexPath);

        // Security checks
        if (!resolvedTexPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(resolvedTexPath)) {
            return res.status(404).json({ success: false, error: 'TeX file not found' });
        }

        const texDir = path.dirname(resolvedTexPath);
        const texFileName = path.basename(resolvedTexPath);
        const pdfFileName = texFileName.replace(/\.tex$/i, '.pdf');
        const generatedPdfPath = path.join(texDir, pdfFileName);

        // Delete old aux files that might cause issues (especially .out files)
        const preCleanExtensions = ['.aux', '.out', '.toc'];
        for (const ext of preCleanExtensions) {
            const auxFile = path.join(texDir, texFileName.replace(/\.tex$/i, ext));
            if (fsSync.existsSync(auxFile)) {
                try {
                    await fs.unlink(auxFile);
                } catch (e) {
                    console.log(`Could not delete aux file ${auxFile}:`, e.message);
                }
            }
        }

        // Compile with pdflatex (run twice for references)
        // Use -interaction=nonstopmode to prevent hanging on errors
        // Use ; instead of && so second run happens even if first has warnings
        const compileCmd = process.platform === 'win32'
            ? `cd /d "${texDir}" && pdflatex -interaction=nonstopmode "${texFileName}" & pdflatex -interaction=nonstopmode "${texFileName}"`
            : `cd "${texDir}" && pdflatex -interaction=nonstopmode "${texFileName}"; pdflatex -interaction=nonstopmode "${texFileName}"`;

        console.log('Compiling LaTeX:', compileCmd);

        let stdout = '';
        let stderr = '';
        let hadErrors = false;

        // Run compilation - don't fail on non-zero exit code
        try {
            const result = await execAsync(compileCmd, { timeout: 120000 });
            stdout = result.stdout || '';
            stderr = result.stderr || '';
        } catch (execError) {
            // pdflatex returns non-zero on warnings/errors but may still produce PDF
            hadErrors = true;
            stdout = execError.stdout || '';
            stderr = execError.stderr || '';
            console.log('LaTeX compilation had errors/warnings, checking if PDF was generated...');
        }

        // Check if PDF was created - this is the real success indicator
        if (!fsSync.existsSync(generatedPdfPath)) {
            return res.status(500).json({
                success: false,
                error: 'PDF generation failed - no output file created',
                log: stdout + '\n' + stderr
            });
        }

        // If outputPath specified and different, copy the PDF
        if (outputPath && outputPath !== texPath.replace(/\.tex$/i, '.pdf')) {
            const fullOutputPath = path.join(APP_ROOT, outputPath);
            const resolvedOutputPath = path.resolve(fullOutputPath);

            if (!resolvedOutputPath.startsWith(path.resolve(SUBJECTS_DIR))) {
                return res.status(403).json({ success: false, error: 'Output path access denied' });
            }

            await fs.copyFile(generatedPdfPath, resolvedOutputPath);
        }

        // Clean up auxiliary files
        const auxExtensions = ['.aux', '.log', '.out', '.toc', '.lof', '.lot', '.fls', '.fdb_latexmk', '.synctex.gz'];
        for (const ext of auxExtensions) {
            const auxFile = path.join(texDir, texFileName.replace(/\.tex$/i, ext));
            if (fsSync.existsSync(auxFile)) {
                try {
                    await fs.unlink(auxFile);
                } catch (e) {
                    console.log(`Could not delete aux file ${auxFile}:`, e.message);
                }
            }
        }

        const resultPdfPath = outputPath || texPath.replace(/\.tex$/i, '.pdf');
        console.log('LaTeX compilation successful:', resultPdfPath, hadErrors ? '(with warnings)' : '');

        res.json({
            success: true,
            message: hadErrors ? 'Compilation completed with warnings' : 'Compilation successful',
            pdfPath: resultPdfPath,
            hadWarnings: hadErrors,
            log: hadErrors ? (stdout + '\n' + stderr).slice(-2000) : '' // Include last 2000 chars of log if there were warnings
        });
    } catch (error) {
        console.error('LaTeX compilation error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            log: error.stderr || error.stdout || ''
        });
    } finally {
        releaseCompileLock(texPath);
    }
});

// Statistics
app.get('/api/statistics', (req, res) => {
    const stats = db.getStatistics();
    res.json({ success: true, stats });
});

// Export data
app.get('/api/export', (req, res) => {
    try {
        const data = db.exportData();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// Serve pages
app.get('/history', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'history.html'));
});

app.get('/subjects.html', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'subjects.html'));
});

app.get('/upload.html', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'upload.html'));
});

// SPA route for PDF viewer - serves index.html for /view URLs
app.get('/view', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ============================================================================
// FILE MANAGER OPERATIONS
// ============================================================================

// Move/Copy files
app.post('/api/file-manager/move', async (req, res) => {
    try {
        const { files, targetCategory, operation } = req.body; // operation: 'move' or 'copy'

        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files specified' });
        }

        if (!targetCategory) {
            return res.status(400).json({ success: false, error: 'No target category specified' });
        }

        const results = [];
        const errors = [];

        for (const filePath of files) {
            try {
                // Security: Ensure the path is within subjects directory
                const fullOldPath = path.join(APP_ROOT, filePath);
                const resolvedOldPath = path.resolve(fullOldPath);
                const subjectsPath = path.resolve(SUBJECTS_DIR);

                if (!resolvedOldPath.startsWith(subjectsPath)) {
                    errors.push({ file: filePath, error: 'Access denied' });
                    continue;
                }

                // Check if source file exists
                if (!fsSync.existsSync(resolvedOldPath)) {
                    errors.push({ file: filePath, error: 'File not found' });
                    continue;
                }

                // Parse the file path to get subject code and filename
                const pathParts = filePath.split('/');
                const subjectCode = pathParts[1]; // subjects/CODE/category/file.pdf
                const fileName = pathParts[pathParts.length - 1];

                // Construct new path
                const newPath = `subjects/${subjectCode}/${targetCategory}/${fileName}`;
                const fullNewPath = path.join(APP_ROOT, newPath);
                const resolvedNewPath = path.resolve(fullNewPath);

                if (!resolvedNewPath.startsWith(subjectsPath)) {
                    errors.push({ file: filePath, error: 'Access denied' });
                    continue;
                }

                // Create destination directory if needed
                const newDir = path.dirname(resolvedNewPath);
                if (!fsSync.existsSync(newDir)) {
                    await fs.mkdir(newDir, { recursive: true });
                }

                // Check if file already exists at destination
                if (fsSync.existsSync(resolvedNewPath)) {
                    errors.push({ file: filePath, error: 'File already exists at destination' });
                    continue;
                }

                // Perform operation
                if (operation === 'copy') {
                    await fs.copyFile(resolvedOldPath, resolvedNewPath);
                } else {
                    await fs.rename(resolvedOldPath, resolvedNewPath);
                    // Update history
                    db.deleteHistoryItem(filePath);
                }

                results.push({ oldPath: filePath, newPath, operation });

            } catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
                errors.push({ file: filePath, error: error.message });
            }
        }

        res.json({
            success: errors.length === 0,
            results,
            errors,
            message: `${operation === 'copy' ? 'Copied' : 'Moved'} ${results.length} file(s)${errors.length > 0 ? `, ${errors.length} failed` : ''}`
        });

    } catch (error) {
        console.error('Move/Copy error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete files
app.post('/api/file-manager/delete', async (req, res) => {
    try {
        const { files } = req.body;

        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files specified' });
        }

        const results = [];
        const errors = [];

        for (const filePath of files) {
            try {
                // Security: Ensure the path is within subjects directory
                const fullPath = path.join(APP_ROOT, filePath);
                const resolvedPath = path.resolve(fullPath);
                const subjectsPath = path.resolve(SUBJECTS_DIR);

                if (!resolvedPath.startsWith(subjectsPath)) {
                    errors.push({ file: filePath, error: 'Access denied' });
                    continue;
                }

                // Check if file exists
                if (!fsSync.existsSync(resolvedPath)) {
                    errors.push({ file: filePath, error: 'File not found' });
                    continue;
                }

                // Delete the file
                await fs.unlink(resolvedPath);

                // Remove from history
                db.deleteHistoryItem(filePath);

                results.push({ file: filePath, deleted: true });

            } catch (error) {
                console.error(`Error deleting file ${filePath}:`, error);
                errors.push({ file: filePath, error: error.message });
            }
        }

        res.json({
            success: errors.length === 0,
            results,
            errors,
            message: `Deleted ${results.length} file(s)${errors.length > 0 ? `, ${errors.length} failed` : ''}`
        });

    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rename file
app.post('/api/file-manager/rename', async (req, res) => {
    try {
        const { oldPath, newName } = req.body;

        if (!oldPath || !newName) {
            return res.status(400).json({ success: false, error: 'Old path and new name required' });
        }

        // Security: Ensure the path is within subjects directory
        const fullOldPath = path.join(APP_ROOT, oldPath);
        const resolvedOldPath = path.resolve(fullOldPath);
        const subjectsPath = path.resolve(SUBJECTS_DIR);

        if (!resolvedOldPath.startsWith(subjectsPath)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Check if source file exists
        if (!fsSync.existsSync(resolvedOldPath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        // Ensure new name ends with .pdf
        const sanitizedName = newName.endsWith('.pdf') ? newName : newName + '.pdf';

        // Construct new path (same directory, different name)
        const oldDir = path.dirname(resolvedOldPath);
        const fullNewPath = path.join(oldDir, sanitizedName);
        const resolvedNewPath = path.resolve(fullNewPath);

        if (!resolvedNewPath.startsWith(subjectsPath)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Check if file already exists
        if (fsSync.existsSync(resolvedNewPath)) {
            return res.status(400).json({ success: false, error: 'File with this name already exists' });
        }

        // Rename the file
        await fs.rename(resolvedOldPath, resolvedNewPath);

        // Update history
        db.deleteHistoryItem(oldPath);

        // Calculate new relative path
        const newPath = oldPath.replace(/[^/]+$/, sanitizedName);

        res.json({
            success: true,
            oldPath,
            newPath,
            message: 'File renamed successfully'
        });

    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// VERSION HISTORY
// ============================================================================

// Get version history for a tex file
app.get('/api/tex-history/:texPath(*)', async (req, res) => {
    try {
        const texPath = req.params.texPath;
        const fullTexPath = path.join(APP_ROOT, texPath);
        const texDir = path.dirname(fullTexPath);
        const texFileName = path.basename(fullTexPath);
        const texBaseName = texFileName.replace(/\.tex$/i, '');
        const backupDir = path.join(texDir, '.backups');

        // Check if backup directory exists
        if (!fsSync.existsSync(backupDir)) {
            return res.json({ success: true, versions: [] });
        }

        // Find all backup files for this tex file
        const files = await fs.readdir(backupDir);
        const backups = [];

        for (const file of files) {
            // Match pattern: basename_BACKUP_timestamp.tex
            const match = file.match(new RegExp(`^${texBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_BACKUP_(\\d{8}_\\d{6})\\.tex$`));
            if (match) {
                const timestamp = match[1];
                // Parse timestamp: 20251223_131642
                const year = timestamp.slice(0, 4);
                const month = timestamp.slice(4, 6);
                const day = timestamp.slice(6, 8);
                const hour = timestamp.slice(9, 11);
                const min = timestamp.slice(11, 13);
                const sec = timestamp.slice(13, 15);
                const date = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}`);

                backups.push({
                    path: path.relative(APP_ROOT, path.join(backupDir, file)).replace(/\\/g, '/'),
                    timestamp: date.toISOString(),
                    filename: file
                });
            }
        }

        // Sort by timestamp descending (newest first)
        backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json({ success: true, versions: backups });

    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Restore a version from backup
app.post('/api/tex-restore', async (req, res) => {
    try {
        const { texPath, backupPath } = req.body;

        if (!texPath || !backupPath) {
            return res.status(400).json({ success: false, error: 'Missing texPath or backupPath' });
        }

        const fullTexPath = path.join(APP_ROOT, texPath);
        const fullBackupPath = path.join(APP_ROOT, backupPath);

        // Security checks
        if (!fullTexPath.startsWith(path.resolve(SUBJECTS_DIR)) ||
            !fullBackupPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(fullBackupPath)) {
            return res.status(404).json({ success: false, error: 'Backup file not found' });
        }

        // First, backup current version before restoring
        const texDir = path.dirname(fullTexPath);
        const texFileName = path.basename(fullTexPath);
        const texBaseName = texFileName.replace(/\.tex$/i, '');
        const backupDir = path.join(texDir, '.backups');

        if (!fsSync.existsSync(backupDir)) {
            await fs.mkdir(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
        const preRestoreBackup = path.join(backupDir, `${texBaseName}_BACKUP_${timestamp}.tex`);

        // Backup current before restoring
        if (fsSync.existsSync(fullTexPath)) {
            await fs.copyFile(fullTexPath, preRestoreBackup);
            console.log('Pre-restore backup created:', preRestoreBackup);
        }

        // Restore from backup
        await fs.copyFile(fullBackupPath, fullTexPath);
        console.log('Restored from backup:', backupPath);

        res.json({ success: true, message: 'Version restored' });

    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// TEX VERSION CONTROL API
// ============================================================================

// Get all versions of a tex file
app.get('/api/tex-versions/:texPath(*)', async (req, res) => {
    try {
        const texPath = req.params.texPath;
        const versions = db.getTexVersions(texPath);
        const versionCount = db.getTexVersionCount(texPath);

        res.json({
            success: true,
            versions,
            totalCount: versionCount
        });
    } catch (error) {
        console.error('Error getting tex versions:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get a specific version's content
app.get('/api/tex-version/:texPath(*)/v/:versionNumber', async (req, res) => {
    try {
        const texPath = req.params.texPath;
        const versionNumber = parseInt(req.params.versionNumber, 10);

        const version = db.getTexVersionContent(texPath, versionNumber);

        if (!version.success) {
            return res.status(404).json(version);
        }

        res.json(version);
    } catch (error) {
        console.error('Error getting tex version content:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Switch to a different version (creates a new version from old content)
// NOTE: This route must be defined BEFORE the general /api/tex-versions/:texPath(*) route
app.post('/api/tex-versions/:texPath(*)/switch/:versionNumber', async (req, res) => {
    try {
        const texPath = req.params.texPath;
        const versionNumber = parseInt(req.params.versionNumber, 10);
        const { summary } = req.body;

        // First get the source version content (for fallback)
        const sourceVersion = db.getTexVersionContent(texPath, versionNumber);

        const result = db.switchTexVersion(texPath, versionNumber, summary || null);

        if (result.success) {
            // Get the new current version (should have the restored content)
            const newVersion = db.getCurrentTexVersion(texPath);
            // Use new version content, fall back to source version content
            const content = newVersion?.content || sourceVersion?.content;
            res.json({
                ...result,
                content
            });
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error switching tex version:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save a new version (called on manual save or significant changes)
app.post('/api/tex-versions/:texPath(*)', async (req, res) => {
    try {
        const texPath = req.params.texPath;
        const { content, summary, source } = req.body;

        if (!content) {
            return res.status(400).json({ success: false, error: 'Content is required' });
        }

        const result = db.saveTexVersion(texPath, content, summary || null, source || 'user');

        if (result.success) {
            res.json(result);
        } else {
            res.status(500).json(result);
        }
    } catch (error) {
        console.error('Error saving tex version:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Compare two versions
app.get('/api/tex-versions/:texPath(*)/compare/:v1/:v2', async (req, res) => {
    try {
        const texPath = req.params.texPath;
        const v1 = parseInt(req.params.v1, 10);
        const v2 = parseInt(req.params.v2, 10);

        const result = db.compareTexVersions(texPath, v1, v2);

        if (result.success) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (error) {
        console.error('Error comparing tex versions:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get current version info (without content for efficiency)
app.get('/api/tex-versions/:texPath(*)/current', async (req, res) => {
    try {
        const texPath = req.params.texPath;
        const version = db.getCurrentTexVersion(texPath);

        if (version) {
            res.json({
                success: true,
                version: {
                    id: version.id,
                    versionNumber: version.versionNumber,
                    summary: version.summary,
                    source: version.source,
                    createdAt: version.createdAt
                }
            });
        } else {
            res.json({ success: true, version: null });
        }
    } catch (error) {
        console.error('Error getting current tex version:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Initialize version control for a file (create first version if not exists)
app.post('/api/tex-versions/:texPath(*)/init', async (req, res) => {
    try {
        const texPath = req.params.texPath;

        // Check if already has versions
        if (db.hasTexVersions(texPath)) {
            return res.json({
                success: true,
                message: 'Version control already initialized',
                versionCount: db.getTexVersionCount(texPath)
            });
        }

        // Read current file content and create first version
        const fullPath = path.join(APP_ROOT, texPath);
        const resolvedPath = path.resolve(fullPath);

        if (!resolvedPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(resolvedPath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        const content = await fs.readFile(resolvedPath, 'utf-8');
        const result = db.saveTexVersion(texPath, content, 'Initial version', 'user');

        res.json({
            ...result,
            message: 'Version control initialized'
        });
    } catch (error) {
        console.error('Error initializing tex version control:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// CLAUDE EDIT INTEGRATION
// ============================================================================

let currentClaudeProcess = null;

// Parse SEARCH/REPLACE blocks from Claude output
function parseSearchReplaceBlocks(output) {
    const blocks = [];
    const regex = /<<<SEARCH>>>\n?([\s\S]*?)<<<REPLACE>>>\n?([\s\S]*?)<<<END>>>/g;
    let match;

    while ((match = regex.exec(output)) !== null) {
        const search = match[1].trim();
        const replace = match[2]; // Don't trim replace - preserve whitespace
        if (search) {
            blocks.push({ search, replace: replace.trimEnd() });
        }
    }

    return blocks;
}

// Apply SEARCH/REPLACE blocks to content
function applySearchReplaceBlocks(content, blocks, sendSSE) {
    let modifiedContent = content;
    let appliedCount = 0;
    let failedCount = 0;
    const changes = [];

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const searchText = block.search;
        const replaceText = block.replace;

        // Try to find the search text
        const index = modifiedContent.indexOf(searchText);

        if (index !== -1) {
            // Found - apply the replacement
            modifiedContent = modifiedContent.slice(0, index) + replaceText + modifiedContent.slice(index + searchText.length);
            appliedCount++;
            changes.push({
                search: searchText.substring(0, 50) + (searchText.length > 50 ? '...' : ''),
                success: true
            });
            if (sendSSE) {
                sendSSE({ type: 'change-applied', index: i + 1, total: blocks.length, preview: searchText.substring(0, 40) });
            }
        } else {
            // Not found - try fuzzy match (ignore leading/trailing whitespace differences)
            const searchLines = searchText.split('\n').map(l => l.trim()).filter(l => l);
            let found = false;

            // Try to find by first and last significant lines
            if (searchLines.length >= 2) {
                const firstLine = searchLines[0];
                const lastLine = searchLines[searchLines.length - 1];
                const contentLines = modifiedContent.split('\n');

                for (let j = 0; j < contentLines.length - searchLines.length + 1; j++) {
                    if (contentLines[j].trim() === firstLine &&
                        contentLines[j + searchLines.length - 1].trim() === lastLine) {
                        // Potential match - verify middle lines
                        let isMatch = true;
                        for (let k = 1; k < searchLines.length - 1; k++) {
                            if (contentLines[j + k].trim() !== searchLines[k]) {
                                isMatch = false;
                                break;
                            }
                        }
                        if (isMatch) {
                            // Found fuzzy match - replace those lines
                            const before = contentLines.slice(0, j).join('\n');
                            const after = contentLines.slice(j + searchLines.length).join('\n');
                            modifiedContent = before + (before ? '\n' : '') + replaceText + (after ? '\n' : '') + after;
                            found = true;
                            appliedCount++;
                            changes.push({
                                search: searchText.substring(0, 50) + (searchText.length > 50 ? '...' : ''),
                                success: true,
                                fuzzy: true
                            });
                            if (sendSSE) {
                                sendSSE({ type: 'change-applied', index: i + 1, total: blocks.length, preview: searchText.substring(0, 40), fuzzy: true });
                            }
                            break;
                        }
                    }
                }
            }

            if (!found) {
                failedCount++;
                changes.push({
                    search: searchText.substring(0, 50) + (searchText.length > 50 ? '...' : ''),
                    success: false
                });
                if (sendSSE) {
                    sendSSE({ type: 'change-failed', index: i + 1, total: blocks.length, preview: searchText.substring(0, 40) });
                }
            }
        }
    }

    return { content: modifiedContent, appliedCount, failedCount, changes };
}

// Base prompt for Claude LaTeX editing
const CLAUDE_BASE_PROMPT = `You are editing a LaTeX document. Follow these rules:
1. Only output the modified LaTeX code, no explanations
2. Preserve the document structure and formatting style
3. Use proper LaTeX syntax (\\\\, \\textbf, \\begin{}, etc.)
4. Maintain consistency with existing packages and commands
5. If you add new packages, note them at the start as a comment

The file will be compiled with pdflatex twice. Common aux files (.aux, .log, .out, .toc) will be deleted before compilation.`;

// Action-specific prompts
const ACTION_PROMPTS = {
    improve: 'Improve the clarity and readability of this LaTeX content',
    fix: 'Fix any LaTeX syntax errors, typos, or formatting issues',
    simplify: 'Simplify this content while preserving meaning',
    expand: 'Expand and elaborate on this content with more detail',
    symbols: 'Convert any plain text math to proper LaTeX math symbols'
};

// Create backup of tex file AND existing PDF for comparison
async function createBackups(texPath) {
    const fullTexPath = path.join(APP_ROOT, texPath);
    const texDir = path.dirname(fullTexPath);
    const texFileName = path.basename(fullTexPath);
    const pdfFileName = texFileName.replace(/\.tex$/i, '.pdf');
    const fullPdfPath = path.join(texDir, pdfFileName);
    const backupDir = path.join(texDir, '.backups');

    // Create .backups directory if it doesn't exist
    if (!fsSync.existsSync(backupDir)) {
        await fs.mkdir(backupDir, { recursive: true });
    }

    // Generate timestamp-based backup filenames (keep extension at end for browser compatibility)
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    const texBaseName = texFileName.replace(/\.tex$/i, '');
    const pdfBaseName = pdfFileName.replace(/\.pdf$/i, '');
    const backupTexFileName = `${texBaseName}_BACKUP_${timestamp}.tex`;
    const backupPdfFileName = `${pdfBaseName}_BACKUP_${timestamp}.pdf`;
    const backupTexPath = path.join(backupDir, backupTexFileName);
    const backupPdfPath = path.join(backupDir, backupPdfFileName);

    // Copy tex file to backup
    await fs.copyFile(fullTexPath, backupTexPath);
    console.log('Created tex backup:', backupTexPath);

    // Copy existing PDF to backup (for comparison) - if it exists
    let oldPdfRelPath = null;
    if (fsSync.existsSync(fullPdfPath)) {
        // Small delay to ensure PDF is not being written
        await new Promise(resolve => setTimeout(resolve, 200));

        // Read and write manually to ensure complete copy
        const pdfData = await fs.readFile(fullPdfPath);
        await fs.writeFile(backupPdfPath, pdfData);

        // Verify the copy
        const backupStats = fsSync.statSync(backupPdfPath);
        const originalStats = fsSync.statSync(fullPdfPath);

        if (backupStats.size === originalStats.size && backupStats.size > 0) {
            oldPdfRelPath = path.relative(APP_ROOT, backupPdfPath).replace(/\\/g, '/');
            console.log('Created PDF backup:', backupPdfPath, '(', backupStats.size, 'bytes)');
        } else {
            console.log('PDF backup size mismatch or empty, skipping');
        }
    } else {
        console.log('No existing PDF to backup');
    }

    return {
        texBackupPath: path.relative(APP_ROOT, backupTexPath).replace(/\\/g, '/'),
        pdfBackupPath: oldPdfRelPath
    };
}

// Parse multi-selection output from Claude
// Claude returns format: === SELECTION 1 === \n content \n === SELECTION 2 === \n content
function parseMultiSelectionOutput(output, expectedCount) {
    const results = [];

    // Try to parse by === SELECTION N === markers
    const regex = /===\s*SELECTION\s*(\d+)\s*===/gi;
    const parts = output.split(regex);

    // parts will be: [before, "1", content1, "2", content2, ...]
    // Skip first element (content before first marker, if any)
    for (let i = 1; i < parts.length; i += 2) {
        const selectionNum = parseInt(parts[i], 10);
        const content = parts[i + 1];
        if (content !== undefined) {
            // Clean up the content - remove leading/trailing whitespace and code blocks
            let cleanContent = content.trim();
            if (cleanContent.startsWith('```latex')) {
                cleanContent = cleanContent.slice(8);
            } else if (cleanContent.startsWith('```')) {
                cleanContent = cleanContent.slice(3);
            }
            if (cleanContent.endsWith('```')) {
                cleanContent = cleanContent.slice(0, -3);
            }
            cleanContent = cleanContent.trim();

            // Store at the correct index (selection numbers are 1-based)
            results[selectionNum - 1] = cleanContent;
        }
    }

    // If we didn't find markers, and there's only 1 expected selection, use the whole output
    if (results.filter(r => r !== undefined).length === 0 && expectedCount === 1) {
        let cleanContent = output.trim();
        if (cleanContent.startsWith('```latex')) {
            cleanContent = cleanContent.slice(8);
        } else if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.slice(3);
        }
        if (cleanContent.endsWith('```')) {
            cleanContent = cleanContent.slice(0, -3);
        }
        results[0] = cleanContent.trim();
    }

    // Fill any gaps with empty strings and ensure correct length
    for (let i = 0; i < expectedCount; i++) {
        if (results[i] === undefined) {
            results[i] = '';
        }
    }

    return results.slice(0, expectedCount);
}

// Claude Edit API endpoint with SSE
app.post('/api/claude-edit', async (req, res) => {
    try {
        const { texPath, selectedText, selectionRange, action, customPrompt, fullContent, editMode, referencedFiles, codeSelections, youtubeTranscripts, images } = req.body;

        // In file mode, selectedText is not required
        const isFileMode = editMode === 'file';

        // Support both old format (selectedText) and new format (codeSelections array)
        const hasSelections = codeSelections && Array.isArray(codeSelections) && codeSelections.length > 0;
        const hasLegacySelection = selectedText && selectionRange;

        if (!texPath || !action || (!isFileMode && !hasSelections && !hasLegacySelection)) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Normalize to codeSelections array format
        let selections = [];
        if (hasSelections) {
            selections = codeSelections;
        } else if (hasLegacySelection) {
            selections = [{ text: selectedText, from: selectionRange.from, to: selectionRange.to }];
        }

        // Security check
        const fullTexPath = path.join(APP_ROOT, texPath);
        const resolvedTexPath = path.resolve(fullTexPath);

        if (!resolvedTexPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(resolvedTexPath)) {
            return res.status(404).json({ success: false, error: 'TeX file not found' });
        }

        // Set up SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const sendSSE = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Create backups (both tex for revert and PDF for comparison)
        const backups = await createBackups(texPath);
        console.log('Backups created:', backups);
        sendSSE({ type: 'backup', backupPath: backups.texBackupPath, oldPdfPath: backups.pdfBackupPath });

        // Load referenced files content
        let referencedContext = '';
        const pdfFilesToPass = []; // Collect PDF paths to pass to Claude CLI

        if (referencedFiles && referencedFiles.length > 0) {
            sendSSE({ type: 'output', data: `Loading ${referencedFiles.length} referenced file(s)...` });

            for (const refPath of referencedFiles) {
                try {
                    const fullRefPath = path.join(APP_ROOT, refPath);
                    const resolvedRefPath = path.resolve(fullRefPath);

                    // Security check - allow subjects dir AND extracted PDFs (same as study-claude)
                    const refInSubjects = resolvedRefPath.startsWith(path.resolve(SUBJECTS_DIR));
                    const refIsExtracted = resolvedRefPath.startsWith(path.resolve(path.join(DATA_DIR, '.extracted-pdfs')));
                    if (!refInSubjects && !refIsExtracted) continue;

                    if (refPath.endsWith('.tex')) {
                        const content = await fs.readFile(resolvedRefPath, 'utf-8');
                        const fileName = path.basename(refPath);
                        referencedContext += `\n--- Referenced file: ${fileName} ---\n\`\`\`latex\n${content}\n\`\`\`\n`;
                    } else if (refPath.endsWith('.pdf')) {
                        // Pass PDF file to Claude CLI as argument (Claude can read PDFs)
                        if (fsSync.existsSync(resolvedRefPath)) {
                            pdfFilesToPass.push(resolvedRefPath);
                            const fileName = path.basename(refPath);
                            referencedContext += `\n--- Referenced PDF: ${fileName} (attached as file) ---\n`;
                        }
                    }
                } catch (err) {
                    console.error(`Failed to load referenced file ${refPath}:`, err);
                }
            }

            // Log PDF files that will be passed to Claude
            if (pdfFilesToPass.length > 0) {
                sendSSE({ type: 'output', data: `📄 ${pdfFilesToPass.length} PDF file(s) will be passed to Claude` });
            }
        }

        // Add YouTube transcripts to context
        if (youtubeTranscripts && youtubeTranscripts.length > 0) {
            sendSSE({ type: 'output', data: `Loading ${youtubeTranscripts.length} YouTube transcript(s)...` });

            for (const yt of youtubeTranscripts) {
                if (yt.transcript) {
                    referencedContext += `\n--- YouTube Video: ${yt.videoId} (${yt.language || 'auto'}) ---\n`;
                    referencedContext += `Video URL: https://youtu.be/${yt.videoId}\n\n`;
                    // Limit transcript length to avoid token limits
                    referencedContext += yt.transcript.substring(0, 30000);
                    if (yt.transcript.length > 30000) {
                        referencedContext += '\n[...transcript truncated]';
                    }
                    referencedContext += '\n';
                }
            }
        }

        // Build the prompt based on mode
        const actionPrompt = action === 'custom' ? customPrompt : ACTION_PROMPTS[action];
        let fullPrompt;
        const isMultiSelection = selections.length > 1;

        if (isFileMode) {
            // File mode - use SEARCH/REPLACE blocks for efficient editing
            fullPrompt = `${CLAUDE_BASE_PROMPT}

${actionPrompt}

Here is the LaTeX file to modify:
\`\`\`latex
${fullContent}
\`\`\`
${referencedContext ? `\nAdditional context:\n${referencedContext}` : ''}

OUTPUT FORMAT - Use SEARCH/REPLACE blocks:
<<<SEARCH>>>
exact text to find
<<<REPLACE>>>
replacement text
<<<END>>>

RULES:
1. Only output SEARCH/REPLACE blocks, nothing else
2. SEARCH must match exactly (copy from file)
3. Keep blocks small and focused
4. Multiple small changes > one big change`;
        } else if (isMultiSelection) {
            // Multi-selection mode - process multiple selections
            const selectionsText = selections.map((sel, i) =>
                `=== SELECTION ${i + 1} (Lines ${sel.from.line + 1}-${sel.to.line + 1}) ===\n${sel.text}`
            ).join('\n\n');

            fullPrompt = `${CLAUDE_BASE_PROMPT}

${actionPrompt}

You are editing MULTIPLE SELECTIONS from a LaTeX file. Here are the selections to modify:

${selectionsText}

Context (full file for reference, do not modify outside selections):
\`\`\`latex
${fullContent}
\`\`\`
${referencedContext ? `\nAdditional context from referenced files:\n${referencedContext}` : ''}

IMPORTANT: Output the modified content for EACH selection in the exact same format:
=== SELECTION 1 ===
[modified content for selection 1]

=== SELECTION 2 ===
[modified content for selection 2]

And so on for each selection. Do not include line numbers or any other formatting - just the separator headers and the modified LaTeX content.`;
        } else {
            // Single selection mode - only edit the selected portion
            const singleSelection = selections[0];
            fullPrompt = `${CLAUDE_BASE_PROMPT}

${actionPrompt}

Here is the selected LaTeX content to modify:
\`\`\`latex
${singleSelection.text}
\`\`\`

Context (full file for reference, do not modify outside selection):
\`\`\`latex
${fullContent}
\`\`\`
${referencedContext ? `\nAdditional context from referenced files:\n${referencedContext}` : ''}
Output ONLY the modified selection content, nothing else.`;
        }

        // Variables needed for compilation
        const texDir = path.dirname(resolvedTexPath);
        const texFileName = path.basename(resolvedTexPath);

        // Write prompt to temp file
        const promptTempFile = path.join(texDir, `.claude-prompt-${Date.now()}.txt`);
        await fs.writeFile(promptTempFile, fullPrompt, 'utf-8');

        // Handle images - save to temp files as positional arguments
        const tempImageFiles = [];
        if (images && Array.isArray(images) && images.length > 0) {
            sendSSE({ type: 'output', data: `📷 Processing ${images.length} attached image(s)...` });
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                if (img.data) {
                    // Extract base64 data (remove data:image/xxx;base64, prefix)
                    const base64Data = img.data.replace(/^data:image\/\w+;base64,/, '');
                    const ext = img.type ? img.type.split('/')[1] || 'png' : 'png';
                    const tempImgPath = path.join(texDir, `.claude-image-${Date.now()}-${i}.${ext}`);
                    await fs.writeFile(tempImgPath, base64Data, 'base64');
                    tempImageFiles.push(tempImgPath);
                }
            }
        }

        // Build file args as positional arguments (images + PDFs, same format as study mode)
        const allFileArgs = [...tempImageFiles, ...pdfFilesToPass].map(f => `"${f}"`).join(' ');

        // Use Claude CLI with --print (matching study mode format)
        const claudeCmd = allFileArgs
            ? `source ~/.nvm/nvm.sh && cat "${promptTempFile}" | claude --dangerously-skip-permissions --print ${allFileArgs}`
            : `source ~/.nvm/nvm.sh && cat "${promptTempFile}" | claude --dangerously-skip-permissions --print`;

        sendSSE({ type: 'claude-start' });
        sendSSE({ type: 'output', data: '🤖 Claude is processing... (CLI mode - output appears when done)' });

        let fullOutput = '';
        let outputStarted = false;

        try {
            // Run Claude CLI
            const result = await new Promise((resolve, reject) => {
                const proc = spawn('/bin/bash', ['-c', claudeCmd], {
                    cwd: texDir,
                    env: { ...process.env, HOME: process.env.HOME }
                });

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data) => {
                    stdout += data.toString();
                    // Show that we're receiving data
                    if (!outputStarted) {
                        outputStarted = true;
                        sendSSE({ type: 'output', data: '📥 Receiving response...' });
                    }
                });

                proc.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                proc.on('close', (code) => {
                    if (code === 0 || stdout) {
                        resolve({ stdout, stderr, code });
                    } else {
                        reject(new Error(stderr || `Exit code ${code}`));
                    }
                });

                proc.on('error', reject);
            });

            fullOutput = result.stdout;

            // Clean up temp files (prompt and images)
            await fs.unlink(promptTempFile).catch(() => {});
            for (const imgFile of tempImageFiles) {
                await fs.unlink(imgFile).catch(() => {});
            }

            sendSSE({ type: 'claude-done' });
            sendSSE({ type: 'output', data: '✓ Claude response received' });

            // Show the raw output in live panel
            if (fullOutput.trim()) {
                const lines = fullOutput.trim().split('\n').slice(0, 20);
                for (const line of lines) {
                    if (line.trim()) {
                        sendSSE({ type: 'live-output', data: line.substring(0, 200) });
                    }
                }
                if (fullOutput.trim().split('\n').length > 20) {
                    sendSSE({ type: 'live-output', data: '... (truncated for display)' });
                }
            }

            // Clean up Claude output (remove markdown code blocks if present)
            let cleanedOutput = fullOutput.trim();
            if (cleanedOutput.startsWith('```latex')) {
                cleanedOutput = cleanedOutput.slice(8);
            } else if (cleanedOutput.startsWith('```')) {
                cleanedOutput = cleanedOutput.slice(3);
            }
            if (cleanedOutput.endsWith('```')) {
                cleanedOutput = cleanedOutput.slice(0, -3);
            }
            cleanedOutput = cleanedOutput.trim();

            sendSSE({ type: 'output', data: '─── Claude finished ───' });

            // Apply changes to the file
            try {
                if (isFileMode) {
                    // Parse SEARCH/REPLACE blocks from Claude output
                    const blocks = parseSearchReplaceBlocks(cleanedOutput);

                    if (blocks.length > 0) {
                        sendSSE({ type: 'live-output', data: `Found ${blocks.length} change(s) to apply...` });

                        // Apply the changes
                        const result = applySearchReplaceBlocks(fullContent, blocks, (msg) => {
                            sendSSE({ type: 'live-output', data: msg.preview || msg.data || 'Applying...' });
                        });

                        if (result.appliedCount > 0) {
                            await fs.writeFile(resolvedTexPath, result.content, 'utf-8');
                            sendSSE({ type: 'output', data: `✓ Applied ${result.appliedCount}/${blocks.length} changes` });
                            sendSSE({
                                type: 'result',
                                newContent: result.content,
                                editMode: editMode,
                                changesApplied: result.appliedCount,
                                changesFailed: result.failedCount
                            });
                        } else {
                            sendSSE({ type: 'error', message: 'No changes could be applied' });
                        }
                    } else {
                        // Fallback: maybe Claude output full file
                        if (cleanedOutput.includes('\\begin{') || cleanedOutput.includes('\\documentclass')) {
                            await fs.writeFile(resolvedTexPath, cleanedOutput, 'utf-8');
                            sendSSE({ type: 'output', data: '✓ File updated (full replacement)' });
                            sendSSE({
                                type: 'result',
                                newContent: cleanedOutput,
                                editMode: editMode
                            });
                        } else {
                            sendSSE({ type: 'error', message: 'Could not parse Claude output' });
                        }
                    }
                } else if (isMultiSelection) {
                    // Multi-selection mode: parse and apply multiple changes
                    // Parse the output to extract each selection's modified content
                    const modifiedSelections = parseMultiSelectionOutput(cleanedOutput, selections.length);

                    if (modifiedSelections.length !== selections.length) {
                        sendSSE({ type: 'error', message: `Expected ${selections.length} selections but got ${modifiedSelections.length}` });
                        sendSSE({ type: 'complete' });
                        res.end();
                        return;
                    }

                    // Sort selections by position (descending) to apply from bottom to top
                    // This prevents line number shifts from affecting subsequent replacements
                    const sortedIndices = selections
                        .map((sel, i) => ({ index: i, from: sel.from }))
                        .sort((a, b) => {
                            if (b.from.line !== a.from.line) return b.from.line - a.from.line;
                            return b.from.ch - a.from.ch;
                        })
                        .map(item => item.index);

                    let currentContent = await fs.readFile(resolvedTexPath, 'utf-8');

                    // Apply each modification from bottom to top
                    for (const idx of sortedIndices) {
                        const sel = selections[idx];
                        const newText = modifiedSelections[idx];
                        const lines = currentContent.split('\n');

                        const fromLine = sel.from.line;
                        const toLine = sel.to.line;
                        const fromCh = sel.from.ch;
                        const toCh = sel.to.ch;

                        const before = lines.slice(0, fromLine).join('\n') +
                            (fromLine > 0 ? '\n' : '') +
                            lines[fromLine].slice(0, fromCh);
                        const after = lines[toLine].slice(toCh) +
                            (toLine < lines.length - 1 ? '\n' : '') +
                            lines.slice(toLine + 1).join('\n');

                        currentContent = before + newText + after;
                    }

                    await fs.writeFile(resolvedTexPath, currentContent, 'utf-8');
                    sendSSE({ type: 'output', data: `✓ ${selections.length} selections updated successfully` });

                    // Send the result back for editor to apply
                    sendSSE({
                        type: 'result',
                        newContent: currentContent,
                        selections: selections.map((sel, i) => ({
                            ...sel,
                            newText: modifiedSelections[i]
                        })),
                        editMode: editMode,
                        isMultiSelection: true
                    });
                } else {
                    // Single selection mode: splice in the changes
                    const singleSelection = selections[0];
                    const currentContent = await fs.readFile(resolvedTexPath, 'utf-8');
                    const lines = currentContent.split('\n');

                    // Replace selected lines
                    const fromLine = singleSelection.from.line;
                    const toLine = singleSelection.to.line;
                    const fromCh = singleSelection.from.ch;
                    const toCh = singleSelection.to.ch;

                    // Handle the replacement
                    const before = lines.slice(0, fromLine).join('\n') +
                        (fromLine > 0 ? '\n' : '') +
                        lines[fromLine].slice(0, fromCh);
                    const after = lines[toLine].slice(toCh) +
                        (toLine < lines.length - 1 ? '\n' : '') +
                        lines.slice(toLine + 1).join('\n');

                    const newContent = before + cleanedOutput + after;
                    await fs.writeFile(resolvedTexPath, newContent, 'utf-8');
                    sendSSE({ type: 'output', data: '✓ Selection updated successfully' });

                    // Send the result back for editor to apply
                    sendSSE({
                        type: 'result',
                        newContent: cleanedOutput,
                        selectionRange: singleSelection,
                        editMode: editMode
                    });
                }
            } catch (writeError) {
                sendSSE({ type: 'error', message: `Failed to update file: ${writeError.message}` });
            }

            // Compile the new version
            sendSSE({ type: 'compile-start' });

            // Acquire compile lock to prevent race conditions
            sendSSE({ type: 'compile-progress', message: 'Waiting for compile lock...' });
            const gotLock = await acquireCompileLock(texPath);
            if (!gotLock) {
                sendSSE({ type: 'error', message: 'Could not acquire compile lock (timeout)' });
                sendSSE({ type: 'complete' });
                res.end();
                return;
            }
            sendSSE({ type: 'compile-progress', message: 'Lock acquired, starting compilation...' });

            try {
                // Delete old aux files
                const preCleanExtensions = ['.aux', '.out', '.toc'];
                for (const ext of preCleanExtensions) {
                    const auxFile = path.join(texDir, texFileName.replace(/\.tex$/i, ext));
                    if (fsSync.existsSync(auxFile)) {
                        try {
                            await fs.unlink(auxFile);
                        } catch (e) { /* ignore */ }
                    }
                }

                const compileCmd = process.platform === 'win32'
                    ? `cd /d "${texDir}" && pdflatex -interaction=nonstopmode "${texFileName}" & pdflatex -interaction=nonstopmode "${texFileName}"`
                    : `cd "${texDir}" && pdflatex -interaction=nonstopmode "${texFileName}"; pdflatex -interaction=nonstopmode "${texFileName}"`;

                try {
                    sendSSE({ type: 'compile-progress', message: 'Running pdflatex (pass 1 of 2)...' });
                    console.log('Claude edit compilation command:', compileCmd);
                    const compileResult = await execAsync(compileCmd, { timeout: 120000 });
                    console.log('Compilation stdout:', compileResult.stdout?.slice(-500));
                    sendSSE({ type: 'compile-progress', message: 'Compilation complete!' });
                } catch (compileError) {
                    // pdflatex returns non-zero on warnings, but PDF may still be created
                    console.log('Compilation error/warning:', compileError.message?.slice(0, 200));
                    sendSSE({ type: 'output', data: 'Compilation had warnings (checking for PDF...)' });
                }

            // Delay to ensure PDF is fully written to disk
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Clean up aux files
            const auxExtensions = ['.aux', '.log', '.out', '.toc', '.lof', '.lot', '.fls', '.fdb_latexmk', '.synctex.gz'];
            for (const ext of auxExtensions) {
                const auxFile = path.join(texDir, texFileName.replace(/\.tex$/i, ext));
                if (fsSync.existsSync(auxFile)) {
                    try {
                        await fs.unlink(auxFile);
                    } catch (e) { /* ignore */ }
                }
            }

            const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
            const fullPdfPath = path.join(APP_ROOT, pdfPath);

            // Helper to check if PDF is valid (starts with %PDF header)
            const isPdfValid = (filePath) => {
                try {
                    const fd = fsSync.openSync(filePath, 'r');
                    const buffer = Buffer.alloc(5);
                    fsSync.readSync(fd, buffer, 0, 5, 0);
                    fsSync.closeSync(fd);
                    return buffer.toString('utf8').startsWith('%PDF');
                } catch (e) {
                    return false;
                }
            };

            console.log('Checking new PDF at:', fullPdfPath);

            // Check if PDF exists and is valid
            const pdfExists = fsSync.existsSync(fullPdfPath);
            const pdfValid = pdfExists && isPdfValid(fullPdfPath);

            console.log('  exists:', pdfExists, 'valid:', pdfValid);

            if (pdfExists && pdfValid) {
                sendSSE({ type: 'compile-done', pdfPath: '/' + pdfPath });

                // Check if backup PDF is also valid
                const backupPdfPath = backups.pdfBackupPath ? path.join(APP_ROOT, backups.pdfBackupPath) : null;
                const backupValid = backupPdfPath && isPdfValid(backupPdfPath);

                console.log('Backup PDF path:', backups.pdfBackupPath, 'valid:', backupValid);

                if (backups.pdfBackupPath && backupValid) {
                    sendSSE({
                        type: 'compare',
                        oldPdfPath: '/' + backups.pdfBackupPath,
                        newPdfPath: '/' + pdfPath,
                        backupPath: backups.texBackupPath
                    });
                    console.log('Sent compare message');
                } else {
                    sendSSE({ type: 'output', data: 'Backup PDF invalid - showing new version only' });
                }
            } else if (pdfExists) {
                sendSSE({ type: 'error', message: 'PDF compilation produced invalid file' });
            } else {
                sendSSE({ type: 'error', message: 'PDF compilation failed - no output file' });
            }

            } finally {
                // Always release compile lock
                releaseCompileLock(texPath);
            }

            sendSSE({ type: 'complete' });
            res.end();

        } catch (apiError) {
            // Clean up temp files on error
            await fs.unlink(promptTempFile).catch(() => {});
            for (const imgFile of tempImageFiles) {
                await fs.unlink(imgFile).catch(() => {});
            }
            sendSSE({ type: 'claude-done' });
            sendSSE({ type: 'error', message: `API Error: ${apiError.message}` });
            sendSSE({ type: 'complete' });
            res.end();
        }

    } catch (error) {
        console.error('Claude edit error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

// Stop Claude process
app.post('/api/claude-edit/stop', (req, res) => {
    if (currentClaudeProcess) {
        currentClaudeProcess.kill();
        currentClaudeProcess = null;
        res.json({ success: true, message: 'Process stopped' });
    } else {
        res.json({ success: false, message: 'No process running' });
    }
});

// ============================================================================
// ASK CLAUDE - CHAT FEATURE
// ============================================================================

// Ask Claude about a document
app.post('/api/ask-claude', async (req, res) => {
    try {
        const { question, documentPath } = req.body;

        if (!question || !documentPath) {
            return res.status(400).json({ success: false, error: 'Missing question or document path' });
        }

        // Security check
        const fullPath = path.join(APP_ROOT, documentPath);
        const resolvedPath = path.resolve(fullPath);

        if (!resolvedPath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Try to find corresponding .tex file first
        let contentSource = '';
        let sourceType = '';
        let sourceFile = '';

        const texPath = documentPath.replace(/\.pdf$/i, '.tex');
        const fullTexPath = path.join(APP_ROOT, texPath);

        if (fsSync.existsSync(fullTexPath)) {
            // Read .tex file
            contentSource = await fs.readFile(fullTexPath, 'utf-8');
            sourceType = 'tex';
            sourceFile = texPath;
        } else if (fsSync.existsSync(fullPath) && documentPath.endsWith('.pdf')) {
            // Fall back to PDF text extraction
            sourceType = 'pdf';
            sourceFile = documentPath;
            contentSource = `[This is a PDF document at path: ${documentPath}. The user is asking about its content.]`;
        } else {
            return res.status(404).json({ success: false, error: 'Document not found' });
        }

        // Build prompt for Claude
        const prompt = `You are a helpful assistant answering questions about a ${sourceType.toUpperCase()} document.

Document content:
\`\`\`${sourceType}
${contentSource.substring(0, 50000)} ${contentSource.length > 50000 ? '...[truncated]' : ''}
\`\`\`

User question: ${question}

Provide a helpful, concise answer. If the question is about specific content, reference the relevant parts.`;

        // Write prompt to temp file to avoid shell escaping issues
        const tempFile = path.join(APP_ROOT, 'data', `.claude-prompt-${Date.now()}.txt`);
        await fs.writeFile(tempFile, prompt, 'utf-8');

        const claudeCmd = `source ~/.nvm/nvm.sh && cat "${tempFile}" | claude --dangerously-skip-permissions --print`;
        console.log('Running Ask Claude command:', claudeCmd);

        try {
            const { stdout } = await execAsync(
                claudeCmd,
                {
                    cwd: path.dirname(resolvedPath),
                    timeout: 120000,
                    maxBuffer: 10 * 1024 * 1024,
                    shell: '/bin/bash'
                }
            );

            // Clean up temp file
            await fs.unlink(tempFile).catch(() => {});

            res.json({
                success: true,
                answer: stdout.trim(),
                sourceFile: sourceFile
            });
        } catch (execError) {
            // Clean up temp file
            await fs.unlink(tempFile).catch(() => {});

            console.error('Claude exec error:', execError);
            res.json({
                success: false,
                error: execError.stderr || execError.message || 'Claude command failed'
            });
        }

    } catch (error) {
        console.error('Ask Claude error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// STUDY WITH CLAUDE - Enhanced Learning Assistant
// ============================================================================

app.post('/api/study-claude', async (req, res) => {
    try {
        const { question, documentPath, referencedFiles = [], youtubeTranscripts = [], slideMode = false, images = [] } = req.body;

        // Allow study with just YouTube references (no document path required)
        if (!question) {
            return res.status(400).json({ success: false, error: 'Missing question' });
        }

        // If no documentPath but we have YouTube transcripts, that's OK
        if (!documentPath && youtubeTranscripts.length === 0 && referencedFiles.length === 0) {
            return res.status(400).json({ success: false, error: 'Missing document or references' });
        }

        // Build context from primary document
        let primaryContent = '';
        let sourceType = 'youtube';
        let sourceFile = 'youtube-only';

        // If we have a documentPath, process it
        if (documentPath) {
            // Security check for primary document
            const fullPath = path.join(APP_ROOT, documentPath);
            const resolvedPath = path.resolve(fullPath);

            // Allow files from subjects dir OR extracted PDFs dir
            const isInSubjects = resolvedPath.startsWith(path.resolve(SUBJECTS_DIR));
            const isExtractedPdf = resolvedPath.startsWith(path.resolve(path.join(DATA_DIR, '.extracted-pdfs')));

            if (!isInSubjects && !isExtractedPdf) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            sourceType = 'tex';
            sourceFile = documentPath;

            // Try .tex file first
            const texPath = documentPath.replace(/\.pdf$/i, '.tex');
            const fullTexPath = path.join(APP_ROOT, texPath);

            if (fsSync.existsSync(fullTexPath)) {
                primaryContent = await fs.readFile(fullTexPath, 'utf-8');
                sourceType = 'tex';
                sourceFile = texPath;
            } else if (documentPath.endsWith('.tex') && fsSync.existsSync(fullPath)) {
                primaryContent = await fs.readFile(fullPath, 'utf-8');
                sourceType = 'tex';
                sourceFile = documentPath;
            } else if (fsSync.existsSync(fullPath) && documentPath.endsWith('.pdf')) {
                sourceType = 'pdf';
                sourceFile = documentPath;
                primaryContent = `[PDF document at: ${documentPath}]`;
            } else if (youtubeTranscripts.length === 0 && referencedFiles.length === 0) {
                // Only error if no other sources
                return res.status(404).json({ success: false, error: 'Document not found' });
            }
        }

        // Build context from referenced files
        let referencesContext = '';
        for (const refPath of referencedFiles) {
            const fullRefPath = path.join(APP_ROOT, refPath);
            const resolvedRef = path.resolve(fullRefPath);

            // Security check - allow subjects dir and extracted PDFs
            const refInSubjects = resolvedRef.startsWith(path.resolve(SUBJECTS_DIR));
            const refIsExtracted = resolvedRef.startsWith(path.resolve(path.join(DATA_DIR, '.extracted-pdfs')));
            if (!refInSubjects && !refIsExtracted) {
                continue;
            }

            // Try to read the file
            let refContent = '';
            const refTexPath = refPath.replace(/\.pdf$/i, '.tex');
            const fullRefTexPath = path.join(APP_ROOT, refTexPath);

            if (fsSync.existsSync(fullRefTexPath)) {
                refContent = await fs.readFile(fullRefTexPath, 'utf-8');
            } else if (refPath.endsWith('.tex') && fsSync.existsSync(fullRefPath)) {
                refContent = await fs.readFile(fullRefPath, 'utf-8');
            }

            if (refContent) {
                const refName = refPath.split('/').pop();
                referencesContext += `\n\n--- Referenced File: ${refName} ---\n${refContent.substring(0, 20000)}${refContent.length > 20000 ? '\n[...truncated]' : ''}`;
            }
        }

        // Add YouTube transcripts to context
        let youtubeContext = '';
        if (youtubeTranscripts && youtubeTranscripts.length > 0) {
            for (const yt of youtubeTranscripts) {
                if (yt.transcript) {
                    youtubeContext += `\n\n--- YouTube Video: ${yt.videoId} (${yt.language || 'auto'}) ---\n`;
                    youtubeContext += `Video URL: https://youtu.be/${yt.videoId}\n\n`;
                    youtubeContext += yt.transcript.substring(0, 30000);
                    if (yt.transcript.length > 30000) {
                        youtubeContext += '\n[...transcript truncated]';
                    }
                }
            }
        }

        // Combine all references
        referencesContext += youtubeContext;

        // Build the prompt based on mode
        let systemPrompt = '';

        if (slideMode) {
            systemPrompt = `You are a brilliant tutor creating an INTERACTIVE SLIDE PRESENTATION with quizzes.

LANGUAGE REQUIREMENT (MANDATORY):
- ALL slides MUST be written in ENGLISH only
- Even if the source material is in Hindi, Urdu, or any other language, you MUST translate and present content in English
- Never output slides in any language other than English
- This applies to all text: titles, bullet points, explanations, examples, everything

CRITICAL: Structure your response as SEPARATE SLIDES using "---SLIDE---" as a delimiter between each slide.

SLIDE FORMAT:
## Slide Title

Content here using standard markdown.

---SLIDE---

## Next Slide Title

More content...

FORMATTING RULES:
- Start each slide with ## Header
- Use **bold** for key terms
- Use bullet points for lists
- Use \`code\` for technical terms
- Use tables when comparing things
- Use $...$ for inline math, $$...$$ for display math
- Use \`\`\`language for code blocks

INTERACTIVE QUIZ COMPONENT (IMPORTANT - USE THIS):
After explaining a concept, add a quiz to test understanding. Format:

:::quiz{question="What is the main purpose of an index?" correct="B" explanation="Indexes speed up data retrieval by creating efficient lookup structures."}
A: To store more data
B: To speed up data retrieval
C: To encrypt data
D: To compress files
:::

QUIZ RULES:
- question: The question text
- correct: The letter of the correct answer (A, B, C, or D)
- explanation: Brief explanation of why the answer is correct
- Include 4 options labeled A:, B:, C:, D:
- Add 1-2 quizzes per presentation to reinforce learning
- Place quizzes after teaching a key concept

OTHER COMPONENTS YOU CAN USE:

:::definition{term="Index"}
A data structure that improves the speed of data retrieval operations.
:::

:::example{title="Creating an Index"}
CREATE INDEX idx_name ON users (email);
:::

:::summary{title="Key Takeaways"}
- Point 1
- Point 2
- Point 3
:::

FLOWCHART/DIAGRAM COMPONENT (USE FOR VISUAL LEARNING):
Use Mermaid.js syntax to create flowcharts, sequence diagrams, and visual explanations:

:::diagram{title="Process Flow" type="flowchart"}
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
:::

DIAGRAM TYPES YOU CAN CREATE:
- flowchart: graph TD or graph LR for process flows
- sequence: sequenceDiagram for interactions between components
- class: classDiagram for OOP relationships
- state: stateDiagram-v2 for state machines
- er: erDiagram for database relationships
- mindmap: mindmap for concept hierarchies

PLAIN ENGLISH COMPONENT (USE FOR COMPLEX CONCEPTS):
Convert abstract math, algorithms, or difficult concepts into simple, intuitive explanations:

:::plainenglish{title="Understanding Binary Search" difficulty="simple"}
**The Big Idea:** Binary search is like finding a word in a dictionary - you don't read every page, you open to the middle and decide which half to look in.

**Step by Step:**
1. Look at the middle element
2. If it's your target, you're done!
3. If target is smaller, search the left half
4. If target is bigger, search the right half
5. Repeat until found

**Real-World Analogy:** Think of it like a guessing game where someone says "higher" or "lower" - each guess eliminates half the possibilities!

**Why It Matters:** This makes searching through millions of items super fast - only ~20 comparisons to search 1 million items!
:::

PLAIN ENGLISH RULES:
- Always include "The Big Idea" for the core concept
- Use numbered "Step by Step" for algorithms
- Include "Real-World Analogy" to connect to familiar concepts
- Add "Why It Matters" for motivation
- Use difficulty: "simple", "intermediate", or "advanced"
- Avoid jargon, use everyday language
- Include intuition and visualization hints

/* TEMPORARILY DISABLED - INTUITION IMAGE COMPONENT
INTUITION IMAGE COMPONENT (USE FOR VISUAL UNDERSTANDING):
Generate an intuitive visual metaphor when explaining abstract or complex concepts.
An AI image will be generated locally to help students visualize the concept.

:::intuition-image{prompt="A thick phone book being opened exactly to the middle page, with a finger pointing at an entry" aspect="wide"}
:::

INTUITION IMAGE RULES:
- prompt: A clear description of the visual metaphor or real-world analogy (REQUIRED)
- aspect: "square" (default, 1:1), "wide" (16:9 for landscapes), or "tall" (9:16 for portraits)
- Use for abstract algorithms, data structures, mathematical concepts that are hard to visualize
- Describe a VISUAL METAPHOR using real-world objects, not the concept itself
- Think: "What real-world image would help someone intuitively understand this?"
- Keep prompts focused on a single clear visual idea with concrete objects
- DO NOT use for simple concepts that don't need visualization
- Use 1-2 intuition images per presentation maximum (they take time to generate)

GOOD INTUITION IMAGE PROMPTS:
- "A stack of cafeteria trays with the top tray being lifted, showing LIFO principle"
- "A tree with labeled branches showing parent-child relationships, roots at bottom"
- "A library card catalog with drawers open, showing organized index cards"
- "Water flowing through pipes of different widths, some narrow some wide, showing bandwidth"
- "A post office with sorting bins and mail carriers, showing message queues"
- "A chef's recipe book with bookmarks sticking out, showing hash table lookups"

BAD INTUITION IMAGE PROMPTS (DO NOT USE):
- "Binary search algorithm" (too abstract, no visual metaphor)
- "Show the code for quicksort" (code cannot be visualized as an image)
- "A computer doing calculations" (too vague, not a clear metaphor)
- "Database indexing concept" (abstract term, not a visual scene)
END TEMPORARILY DISABLED */

ANIMATED STEP VISUALIZER (USE FOR PROCESSES & ALGORITHMS):
Create an immersive card-based step visualizer that shows one step at a time with smooth animations:

:::stepviz{title="Binary Search Algorithm" speed="2500"}
1. Start with middle element | Compare target with arr[mid]
2. If target equals middle | Found! Return the index
3. If target < middle | Search left half only
4. If target > middle | Search right half only
5. Repeat until found or exhausted | Return -1 if not found
:::

STEPVIZ OPTIONS:
- title: Header text for the visualizer (optional)
- speed: Animation delay in milliseconds between steps (default: 2500)
- autoplay: "true" to start animation automatically (default: false)

STEPVIZ FORMAT:
- Each line is a step: "Step title | Optional description"
- Numbers are optional (1. 2. 3. or just text)
- The | separator divides the step title from its description
- Keep titles concise (shown as card headlines), descriptions explain the step

WHEN TO USE STEPVIZ:
- Algorithms (sorting, searching, graph traversal)
- Processes (compilation steps, request lifecycle)
- Workflows (CI/CD pipeline, data processing)
- Any sequential procedure that benefits from animation

FLASHCARD COMPONENT (USE FOR ACTIVE RECALL):
Create flip cards for key concepts that students should memorize and recall.

:::flashcard{topic="Big-O Notation"}
FRONT: What is the time complexity of binary search?
BACK: O(log n) - because we halve the search space each iteration
HINT: Think about how many times you can divide n by 2
:::

FLASHCARD SYNTAX REQUIREMENTS (MUST FOLLOW EXACTLY):
1. Start with :::flashcard{topic="Topic Name"}
2. FRONT: on its own line, followed by the question (same line or next)
3. BACK: on its own line, followed by the answer (same line or next)
4. HINT: (optional) on its own line with the hint
5. End with ::: on its own line

FLASHCARD CONTENT RULES:
- topic: Short label in quotes (e.g., "Big-O", "SQL", "Data Structures")
- FRONT: The question - keep to 1-2 sentences max
- BACK: The answer - concise, direct answer
- HINT: Optional clue to help recall (shown before flip)
- NO markdown formatting inside FRONT/BACK/HINT (plain text only)
- NO multi-paragraph content - keep it single line each

WHEN TO USE FLASHCARD:
- Definitions (What is X?)
- Formulas (What is the formula for X?)
- Key facts (What are the properties of X?)
- Comparisons (What is the difference between X and Y?)
- Time/Space complexity questions
- Terminology and acronyms

WHEN NOT TO USE FLASHCARD:
- Complex explanations (use plainenglish instead)
- Code examples (use code block instead)
- Step-by-step processes (use stepviz instead)
- Multiple related concepts (use multiple flashcards)

CODE TRACER COMPONENT (USE FOR ALGORITHM VISUALIZATION):
Interactive modal showing algorithm code execution with live state visualization.
Opens in a modal popup with the actual code on the left and execution state on the right.

CRITICAL: You MUST use the EXACT algorithm format from the source document/lecture slides.
- DO NOT translate pseudocode to Python or any other programming language
- Preserve the teacher's exact notation: arrows (←), set membership (∈), keywords (function, while, do, etc.)
- Keep function names exactly as written in the source (InitNode, GoalTest, SuccNode, etc.)
- Use lang="pseudocode" for algorithms from lecture slides

:::trace{title="DFS Search" lang="pseudocode"}
CODE:
function DFS() returns a solution, or "unsolvable"
   n ← InitNode();
   Q ← Empty LIFO queue (stack);
   Push(Q,n)
   while Q is not empty do
      n ← Pop(Q)
      if GoalTest(n.State) then return ExtractSolution(n);
      for each a ∈ Actions(n.State) do
         n' ← SuccNode(n,a);
         Push(Q,n');
   return "unsolvable"

STEPS:
| Line | Q | n | n.State | Action |
| 2 | - | InitNode() | S | Initialize with start state S |
| 3 | [] | n | S | Create empty LIFO queue |
| 4 | [n] | n | S | Push initial node to queue |
| 6 | [n] | n | S | Pop node from queue |
| 7 | [n] | n | S | Check if goal - not goal |
| 8-10 | [n',n''] | n | S | Generate successors and push to Q |
| 6 | [n''] | n' | A | Pop next node (LIFO order) |
:::

TRACE SYNTAX REQUIREMENTS (CRITICAL - MUST FOLLOW EXACTLY):
1. Start with :::trace{title="Name" lang="language"}
2. CODE: must be on its own line, followed by the algorithm code
3. STEPS: must be on its own line, followed by a markdown table
4. End with ::: on its own line
5. NO extra blank lines between CODE: and the code
6. NO extra blank lines between STEPS: and the table

LINE NUMBER RULES (VERY IMPORTANT):
- Line 1 is the FIRST line of your CODE section
- Count EVERY line including blank lines and comments
- The Line column value must match an actual line in your code
- Example: if "queue = [start]" is the 3rd line of CODE, use Line = 3

TABLE FORMAT RULES:
- First column MUST be "Line" (the line number being executed)
- Last column MUST be "Action" (description of what happens)
- Middle columns are variable states (queue, stack, visited, etc.)
- EVERY cell must have a value - use "-" for empty/undefined
- Use simple values: [A,B], {A,B}, 5, "text", true, null, -
- NO pipes (|) inside cell values
- Keep variable names short: queue, visited, node, i, left, right

WHAT NOT TO DO:
- DON'T use line numbers that don't exist in your code
- DON'T leave any table cell empty (use "-" instead)
- DON'T put the separator row (|---|---|) - it's auto-handled
- DON'T use complex expressions in cells - keep values simple
- DON'T exceed 10 steps - pick the most important ones
- DON'T include the function signature line unless relevant

WHEN TO USE CODE TRACER:
- BFS/DFS graph traversals
- Sorting algorithms (bubble, merge, quick)
- Searching algorithms (binary search)
- Stack/Queue operations
- Recursion with call stack visualization
- Dynamic programming table filling
- Two-pointer techniques
- Sliding window algorithms

VERSUS COMPARISON COMPONENT (USE FOR SIDE-BY-SIDE COMPARISONS):
Interactive split-screen comparison with hover highlighting and hidden insights reveal.
Perfect for comparing similar algorithms, SQL constructs, or concepts.

:::versus{left="DFS" right="BFS"}
| Aspect | DFS | BFS |
| Data Structure | Stack (LIFO) | Queue (FIFO) |
| Completeness | No (infinite) | Yes |
| Optimality | No | Yes (unit cost) |
| Space | O(bm) | O(b^d) |
HIDDEN:
| When to use | Deep solutions, memory limited | Shortest path needed |
| Real example | Maze solving, topological sort | Social network degrees |
:::

VERSUS SYNTAX REQUIREMENTS:
1. Start with :::versus{left="Label A" right="Label B"}
2. Table format: | Aspect | Left Value | Right Value |
3. First column is the aspect name, second is left value, third is right value
4. HIDDEN: section (optional) - rows revealed on click for deeper insights
5. End with ::: on its own line

VERSUS RULES:
- Keep aspect names short and clear
- Values should be concise (1-5 words ideally)
- Use HIDDEN: for "when to use", "real examples", "gotchas", "tips"
- 4-8 visible rows is ideal, 2-4 hidden rows
- Great for: DFS vs BFS, INNER vs OUTER JOIN, Linear vs Logistic Regression, 2NF vs 3NF

WHEN TO USE VERSUS:
- Comparing two similar algorithms (DFS vs BFS, A* vs Greedy)
- SQL constructs (JOIN types, subquery vs CTE)
- Database concepts (2NF vs 3NF vs BCNF)
- ML models (Linear vs Logistic, Batch vs Stochastic GD)
- Any two concepts students often confuse

EXAMPLE PRESENTATION:

## Introduction to Database Indexes

An **index** is a data structure that improves the speed of data retrieval.

:::definition{term="Database Index"}
A data structure that allows the database to find rows quickly without scanning the entire table.
:::

**Why use indexes?**
- Faster queries
- Reduced I/O operations
- Better performance for large tables

---SLIDE---

## Types of Indexes

| Type | Description | Use Case |
|------|-------------|----------|
| B-Tree | Balanced tree structure | General purpose |
| Hash | Key-value lookup | Equality queries |
| Bitmap | Bit arrays | Low cardinality |

---SLIDE---

## Quick Check

:::quiz{question="Which index type is best for equality comparisons like WHERE id = 5?" correct="B" explanation="Hash indexes are optimized for exact equality lookups, providing O(1) access time."}
A: B-Tree Index
B: Hash Index
C: Bitmap Index
D: Full-text Index
:::

---SLIDE---

## How Index Lookup Works

:::stepviz{title="B-Tree Index Search" speed="2000"}
1. Start at root node | Contains range pointers
2. Compare search key | Find correct child pointer
3. Navigate to child | Move down one level
4. Repeat comparison | Continue until leaf level
5. Reach leaf node | Contains actual row pointers
6. Fetch data row | Return the result
:::

---SLIDE---

## Creating an Index

\`\`\`sql
CREATE INDEX idx_name ON table_name (column);
\`\`\`

**Best Practices:**
- Index columns used in WHERE clauses
- Consider query patterns
- Balance read vs write performance

---SLIDE---

## Summary

:::summary{title="Key Takeaways"}
- Indexes improve query performance
- Choose the right index type for your use case
- Too many indexes can slow down writes
:::

GUIDELINES:
- Create 4-8 slides total
- Keep each slide focused on ONE main idea
- Include 1-2 quiz slides to test understanding
- Use :::diagram for flowcharts and visual process explanations
- Use :::stepviz for algorithms, processes, and sequential workflows
- Use :::plainenglish to break down complex/abstract concepts
- End with a summary slide
- Make content educational, visual, and intuitive`;
        } else {
            systemPrompt = `You are a helpful study assistant answering questions about academic documents.

LANGUAGE REQUIREMENT: Always respond in ENGLISH, even if the source material is in Hindi, Urdu, or another language. Translate content when needed.

FORMAT YOUR RESPONSE USING:
- **Bold** for key terms
- LaTeX math: $inline$ and $$display$$ for equations
- \`code\` for technical terms
- Bullet points for lists
- Headers (##) for sections if the answer is long
- Tables for comparisons
- \`\`\`language for code blocks

Be concise but thorough. Focus on explaining concepts clearly.`;
        }

        const prompt = `${systemPrompt}

=== PRIMARY DOCUMENT (${sourceType.toUpperCase()}: ${sourceFile}) ===
${primaryContent.substring(0, 50000)}${primaryContent.length > 50000 ? '\n[...truncated]' : ''}
${referencesContext ? `\n=== ADDITIONAL REFERENCES ===${referencesContext}` : ''}

=== STUDENT QUESTION ===
${question}

Provide a helpful, educational response:`;

        // Write prompt to temp file
        const tempFile = path.join(APP_ROOT, 'data', `.study-prompt-${Date.now()}.txt`);
        await fs.writeFile(tempFile, prompt, 'utf-8');

        // Handle images - save to temp files
        const tempImageFiles = [];
        if (images && images.length > 0) {
            for (let i = 0; i < images.length; i++) {
                const img = images[i];
                const ext = img.type.split('/')[1] || 'png';
                const imgPath = path.join(APP_ROOT, 'data', `.study-image-${Date.now()}-${i}.${ext}`);
                const imgBuffer = Buffer.from(img.data, 'base64');
                await fs.writeFile(imgPath, imgBuffer);
                tempImageFiles.push(imgPath);
            }
        }

        // Build Claude command with optional image attachments
        const imageArgs = tempImageFiles.map(f => `"${f}"`).join(' ');
        const claudeCmd = tempImageFiles.length > 0
            ? `source ~/.nvm/nvm.sh && cat "${tempFile}" | claude --dangerously-skip-permissions --print ${imageArgs}`
            : `source ~/.nvm/nvm.sh && cat "${tempFile}" | claude --dangerously-skip-permissions --print`;
        console.log('Running Study Claude command...' + (tempImageFiles.length > 0 ? ` with ${tempImageFiles.length} image(s)` : ''));

        // Determine working directory - use document path if available, otherwise use APP_ROOT
        const workingDir = documentPath ? path.dirname(path.join(APP_ROOT, documentPath)) : APP_ROOT;

        try {
            const { stdout } = await execAsync(
                claudeCmd,
                {
                    cwd: workingDir,
                    timeout: 180000, // 3 minutes
                    maxBuffer: 10 * 1024 * 1024,
                    shell: '/bin/bash'
                }
            );

            // Clean up temp files
            await fs.unlink(tempFile).catch(() => {});
            for (const imgFile of tempImageFiles) {
                await fs.unlink(imgFile).catch(() => {});
            }

            res.json({
                success: true,
                answer: stdout.trim(),
                sourceFile: sourceFile
            });
        } catch (execError) {
            // Clean up temp files on error too
            await fs.unlink(tempFile).catch(() => {});
            for (const imgFile of tempImageFiles) {
                await fs.unlink(imgFile).catch(() => {});
            }
            console.error('Study Claude exec error:', execError);
            res.json({
                success: false,
                error: execError.stderr || execError.message || 'Claude command failed'
            });
        }

    } catch (error) {
        console.error('Study Claude error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save chat history
app.post('/api/chat-history', async (req, res) => {
    try {
        const { documentPath, question, answer } = req.body;

        if (!documentPath || !question || !answer) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        // Save to database
        db.saveChatHistory(documentPath, question, answer);

        res.json({ success: true });
    } catch (error) {
        console.error('Save chat history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get chat history for a document
app.get('/api/chat-history', async (req, res) => {
    try {
        const { documentPath } = req.query;

        if (!documentPath) {
            return res.status(400).json({ success: false, error: 'Missing document path' });
        }

        const history = db.getChatHistory(documentPath);

        res.json({ success: true, history });
    } catch (error) {
        console.error('Get chat history error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Revert Claude changes
app.post('/api/claude-edit/revert', async (req, res) => {
    try {
        const { texPath, backupPath } = req.body;

        if (!texPath || !backupPath) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const fullTexPath = path.join(APP_ROOT, texPath);
        const fullBackupPath = path.join(APP_ROOT, backupPath);

        // Security checks
        if (!path.resolve(fullTexPath).startsWith(path.resolve(SUBJECTS_DIR)) ||
            !path.resolve(fullBackupPath).startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(fullBackupPath)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }

        // Copy backup back to original
        await fs.copyFile(fullBackupPath, fullTexPath);

        res.json({ success: true, message: 'Reverted successfully' });
    } catch (error) {
        console.error('Revert error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// PDF PAGE EXTRACTION - Extract specific pages from PDF for context reduction
// ============================================================================

// Temp folder for extracted PDFs (hidden from finder)
const EXTRACTED_PDF_DIR = path.join(DATA_DIR, '.extracted-pdfs');
if (!fsSync.existsSync(EXTRACTED_PDF_DIR)) {
    fsSync.mkdirSync(EXTRACTED_PDF_DIR, { recursive: true });
}

// Cleanup old extracted PDFs on startup (older than 1 hour)
async function cleanupExtractedPdfs() {
    try {
        const files = await fs.readdir(EXTRACTED_PDF_DIR);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const file of files) {
            const filePath = path.join(EXTRACTED_PDF_DIR, file);
            const stats = await fs.stat(filePath);
            if (stats.mtimeMs < oneHourAgo) {
                await fs.unlink(filePath).catch(() => {});
            }
        }
    } catch (error) {
        // Ignore errors
    }
}
cleanupExtractedPdfs();

// Extract specific pages from a PDF using pdf-lib (pure JavaScript, no external tools needed)
app.post('/api/extract-pdf-pages', async (req, res) => {
    try {
        const { sourcePath, pages } = req.body;

        if (!sourcePath || !pages || !Array.isArray(pages) || pages.length === 0) {
            return res.status(400).json({ success: false, error: 'Missing source path or pages array' });
        }

        // Security check
        const fullSourcePath = path.join(APP_ROOT, sourcePath);
        const resolvedSourcePath = path.resolve(fullSourcePath);

        if (!resolvedSourcePath.startsWith(path.resolve(SUBJECTS_DIR))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(resolvedSourcePath)) {
            return res.status(404).json({ success: false, error: 'Source PDF not found' });
        }

        // Create unique filename for extracted PDF
        const originalName = path.basename(sourcePath, '.pdf');
        const pageRangeStr = formatPageRangeForFilename(pages);
        const timestamp = Date.now();
        const extractedFileName = `${originalName}_pages_${pageRangeStr}_${timestamp}.pdf`;
        const extractedPath = path.join(EXTRACTED_PDF_DIR, extractedFileName);

        console.log(`Extracting pages ${pages.join(', ')} from ${sourcePath}...`);

        // Use pdf-lib for extraction (pure JavaScript, no external tools needed)
        const sourcePdfBytes = await fs.readFile(resolvedSourcePath);
        const sourcePdf = await PDFDocument.load(sourcePdfBytes);
        const extractedPdf = await PDFDocument.create();

        // Sort pages and convert to 0-based indices
        const sortedPages = [...pages].sort((a, b) => a - b);
        const pageIndices = sortedPages.map(p => p - 1); // Convert to 0-based

        // Validate page indices
        const totalPages = sourcePdf.getPageCount();
        for (const idx of pageIndices) {
            if (idx < 0 || idx >= totalPages) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid page number. PDF has ${totalPages} pages.`
                });
            }
        }

        // Copy selected pages to new document
        const copiedPages = await extractedPdf.copyPages(sourcePdf, pageIndices);
        for (const page of copiedPages) {
            extractedPdf.addPage(page);
        }

        // Save the extracted PDF
        const extractedPdfBytes = await extractedPdf.save();
        await fs.writeFile(extractedPath, extractedPdfBytes);

        console.log(`Successfully extracted ${pages.length} page(s) to ${extractedFileName}`);

        // Return the relative path to the extracted PDF
        const relativePath = path.relative(APP_ROOT, extractedPath).replace(/\\/g, '/');

        res.json({
            success: true,
            extractedPath: relativePath,
            originalPath: sourcePath,
            pages: pages,
            message: `Extracted ${pages.length} page(s)`
        });

    } catch (error) {
        console.error('Extract PDF pages error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve extracted PDFs
app.use('/data/.extracted-pdfs', express.static(EXTRACTED_PDF_DIR));

// Helper function to format page range for filename
function formatPageRangeForFilename(pages) {
    const sorted = [...pages].sort((a, b) => a - b);
    if (sorted.length <= 3) {
        return sorted.join('-');
    }
    return `${sorted[0]}-${sorted[sorted.length - 1]}`;
}

// ============================================================================
// YOUTUBE TRANSCRIPT API
// ============================================================================

const YOUTUBE_TRANSCRIPTS_DIR = path.join(DATA_DIR, '.youtube-transcripts');

// Ensure YouTube transcripts directory exists
if (!fsSync.existsSync(YOUTUBE_TRANSCRIPTS_DIR)) {
    fsSync.mkdirSync(YOUTUBE_TRANSCRIPTS_DIR, { recursive: true });
}

// Extract video ID from YouTube URL
function extractYouTubeVideoId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            return match[1];
        }
    }
    return null;
}

// Get YouTube transcript using Python script
app.post('/api/youtube-transcript', async (req, res) => {
    try {
        const { url, language = 'auto' } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        const videoId = extractYouTubeVideoId(url);
        if (!videoId) {
            return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
        }

        // Check if we have a cached transcript
        const cacheFile = path.join(YOUTUBE_TRANSCRIPTS_DIR, `${videoId}_${language}.json`);
        if (fsSync.existsSync(cacheFile)) {
            try {
                const cached = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
                // Cache valid for 24 hours
                if (cached.timestamp && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
                    console.log('Returning cached YouTube transcript for:', videoId);
                    return res.json(cached.data);
                }
            } catch (e) {
                console.log('Cache read error, fetching fresh:', e.message);
            }
        }

        // Run Python script to get transcript
        const scriptPath = path.join(APP_ROOT, 'scripts', 'youtube_transcript.py');

        console.log('Fetching YouTube transcript:', videoId, 'language:', language);

        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        // Redirect stderr to /dev/null to avoid Python warnings in stdout
        const stderrRedirect = process.platform === 'win32' ? '2>nul' : '2>/dev/null';

        // Whisper mode takes longer (downloading + transcribing)
        const isWhisperMode = language === 'hi-whisper';
        const timeout = isWhisperMode ? 300000 : 60000; // 5 min for whisper, 1 min for API

        console.log(`Using ${isWhisperMode ? 'Whisper AI' : 'YouTube API'} for transcript`);

        const result = await execAsync(
            `${pythonCmd} "${scriptPath}" "${videoId}" ${language} ${stderrRedirect}`,
            { timeout: timeout, maxBuffer: 10 * 1024 * 1024 }
        );

        let transcriptData;
        try {
            transcriptData = JSON.parse(result.stdout);
        } catch (parseError) {
            console.error('Failed to parse transcript JSON:', result.stdout);
            return res.status(500).json({
                success: false,
                error: 'Failed to parse transcript response'
            });
        }

        if (!transcriptData.success) {
            return res.status(400).json(transcriptData);
        }

        // Cache the result
        try {
            await fs.writeFile(cacheFile, JSON.stringify({
                timestamp: Date.now(),
                data: transcriptData
            }), 'utf-8');
        } catch (cacheError) {
            console.log('Cache write error:', cacheError.message);
        }

        res.json(transcriptData);

    } catch (error) {
        console.error('YouTube transcript error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch transcript'
        });
    }
});

// Get available languages for a YouTube video
app.get('/api/youtube-languages/:videoId', async (req, res) => {
    try {
        const { videoId } = req.params;

        if (!videoId || videoId.length !== 11) {
            return res.status(400).json({ success: false, error: 'Invalid video ID' });
        }

        const scriptPath = path.join(APP_ROOT, 'scripts', 'youtube_transcript.py');
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        const stderrRedirect = process.platform === 'win32' ? '2>nul' : '2>/dev/null';

        const result = await execAsync(
            `${pythonCmd} "${scriptPath}" "${videoId}" --languages ${stderrRedirect}`,
            { timeout: 30000 }
        );

        const languageData = JSON.parse(result.stdout);
        res.json(languageData);

    } catch (error) {
        console.error('YouTube languages error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to get available languages'
        });
    }
});

// Save YouTube transcript as a reference file (txt format)
app.post('/api/save-youtube-transcript', async (req, res) => {
    try {
        const { videoId, transcript, title, language, subjectCode } = req.body;

        if (!videoId || !transcript || !subjectCode) {
            return res.status(400).json({
                success: false,
                error: 'videoId, transcript, and subjectCode are required'
            });
        }

        // Create filename
        const sanitizedTitle = (title || videoId)
            .replace(/[^a-zA-Z0-9-_]/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 50);
        const filename = `yt-${sanitizedTitle}-${language || 'auto'}.txt`;

        // Save to subject's notes folder
        const notesDir = path.join(SUBJECTS_DIR, subjectCode, 'notes');
        if (!fsSync.existsSync(notesDir)) {
            await fs.mkdir(notesDir, { recursive: true });
        }

        const filePath = path.join(notesDir, filename);

        // Create formatted transcript content
        const content = `YouTube Video Transcript
========================
Video ID: ${videoId}
URL: https://youtu.be/${videoId}
Language: ${language || 'auto-detected'}
Generated: ${new Date().toISOString()}
========================

${transcript}`;

        await fs.writeFile(filePath, content, 'utf-8');

        const relativePath = `subjects/${subjectCode}/notes/${filename}`;

        res.json({
            success: true,
            path: relativePath,
            filename: filename,
            message: 'Transcript saved successfully'
        });

    } catch (error) {
        console.error('Save YouTube transcript error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// INTUITION IMAGE GENERATION API - Local SDXL Turbo
// ============================================================================

const INTUITION_IMAGES_DIR = path.join(DATA_DIR, '.intuition-images');

// Ensure intuition images directory exists
if (!fsSync.existsSync(INTUITION_IMAGES_DIR)) {
    fsSync.mkdirSync(INTUITION_IMAGES_DIR, { recursive: true });
}

// Serve generated intuition images
app.use('/intuition-images', express.static(INTUITION_IMAGES_DIR));

// Generate intuition image using local SDXL Turbo
app.post('/api/generate-intuition-image', async (req, res) => {
    try {
        const { prompt, aspect = 'square' } = req.body;

        if (!prompt) {
            return res.status(400).json({
                success: false,
                error: 'Prompt is required'
            });
        }

        // Validate aspect ratio
        const validAspects = ['square', 'wide', 'tall'];
        const safeAspect = validAspects.includes(aspect) ? aspect : 'square';

        // Path to Python script
        const scriptPath = path.join(APP_ROOT, 'scripts', 'intuition_image.py');

        // Check if script exists
        if (!fsSync.existsSync(scriptPath)) {
            return res.status(500).json({
                success: false,
                error: 'Intuition image script not found'
            });
        }

        console.log('Generating intuition image:', prompt.substring(0, 50) + '...', 'aspect:', safeAspect);

        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

        // Execute Python script with timeout (image generation can take 10-30 seconds first time)
        const { stdout, stderr } = await execAsync(
            `${pythonCmd} "${scriptPath}" "${prompt.replace(/"/g, '\\"')}" --aspect ${safeAspect}`,
            {
                cwd: APP_ROOT,
                timeout: 120000, // 2 minute timeout for first-time model download
                maxBuffer: 10 * 1024 * 1024
            }
        );

        if (stderr && !stderr.includes('UserWarning') && !stderr.includes('FutureWarning')) {
            console.error('Intuition image stderr:', stderr);
        }

        // Parse JSON result
        let result;
        try {
            result = JSON.parse(stdout.trim());
        } catch (parseError) {
            console.error('Failed to parse intuition image output:', stdout);
            return res.status(500).json({
                success: false,
                error: 'Invalid response from image generator'
            });
        }

        if (!result.success) {
            console.error('Intuition image generation failed:', result.error);
            return res.status(500).json(result);
        }

        console.log('Intuition image generated:', result.imagePath);
        res.json(result);

    } catch (error) {
        console.error('Intuition image API error:', error);

        // Check if it's a timeout error
        if (error.killed || error.signal === 'SIGTERM') {
            return res.status(504).json({
                success: false,
                error: 'Image generation timed out. First run may take longer due to model download.'
            });
        }

        res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate image'
        });
    }
});

// Serve main page
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.match(/\.\w+$/)) {
        return next();
    }
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Serving subjects from: ${SUBJECTS_DIR}`);
});

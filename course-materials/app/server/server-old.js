const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Create uploads directory if it doesn't exist
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fsSync.existsSync(uploadDir)) {
            fsSync.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Only accept PDF files
        if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
            return cb(new Error('Only PDF files are allowed'));
        }
        cb(null, true);
    },
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max file size
    }
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Function to recursively scan directories for PDF files
async function scanDirectory(dirPath, baseDir = dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let files = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            // Skip hidden directories and common non-content folders
            if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                const subFiles = await scanDirectory(fullPath, baseDir);
                files = files.concat(subFiles);
            }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            files.push({
                name: entry.name,
                path: relativePath.replace(/\\/g, '/'), // Normalize path for web
                fullPath: fullPath,
                directory: path.dirname(relativePath).replace(/\\/g, '/')
            });
        }
    }

    return files;
}

// Function to categorize PDFs based on their path
function categorizePDFs(files) {
    const structure = {
        notes: {},
        slides: [],
        exercises: [],
        exercisesNoSolutions: [],
        blueprint: [],
        teachersMethod: []
    };

    files.forEach(file => {
        const dirParts = file.directory.split('/');
        const fileName = file.name.toLowerCase();
        const fileDir = file.directory.toLowerCase();

        // IMPROVED CATEGORIZATION LOGIC
        // Check filename patterns first, then directory

        // Teachers Method - check both directory and filename
        if (fileDir.includes('teachers-method') || fileDir.includes('teacher-method') ||
            fileName.includes('teacher') && (fileName.includes('methodology') || fileName.includes('method'))) {
            structure.teachersMethod.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Teachers Method',
                lecture: extractLectureNumber(file.name)
            });
        }
        // Blueprint - check both directory and filename
        else if (fileDir.includes('blueprint') || fileName.includes('blueprint')) {
            structure.blueprint.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Blueprint',
                lecture: extractLectureNumber(file.name)
            });
        }
        // Exercises (No Solutions) - check directory AND specific patterns
        else if (fileDir.includes('exercises-no-solutions') ||
                 (fileName.includes('sheet') && !fileName.includes('cheat'))) {
            structure.exercisesNoSolutions.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Exercises (No Solutions)',
                lecture: extractLectureNumber(file.name)
            });
        }
        // Regular Exercises - only if explicitly in exercises directory
        else if (fileDir.includes('exercises') && !fileDir.includes('exercises-no-solutions')) {
            structure.exercises.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Exercises',
                lecture: extractLectureNumber(file.name)
            });
        }
        // Lecture Notes
        else if (fileDir.includes('notes')) {
            // Extract lecture folder name
            const lectureFolder = dirParts.find(part => part.startsWith('lecture-') || part.includes('lecture'));
            const lectureName = lectureFolder ? formatLectureName(lectureFolder) : 'Other Notes';

            if (!structure.notes[lectureName]) {
                structure.notes[lectureName] = [];
            }

            structure.notes[lectureName].push({
                title: formatFileName(file.name),
                path: file.path,
                lecture: extractLectureNumber(file.directory)
            });
        }
        // Lecture Slides
        else if (fileDir.includes('slides') || fileDir.includes('lecture slides')) {
            structure.slides.push({
                title: formatFileName(file.name),
                path: file.path,
                category: 'Lecture Slides',
                lecture: extractLectureNumber(file.name)
            });
        }
    });

    return structure;
}

// Helper function to format lecture folder name
function formatLectureName(folderName) {
    // Convert "lecture-2-uninformed-search" to "Lecture 2 - Uninformed Search"
    return folderName
        .split('-')
        .map((word, index) => {
            if (index === 0 && word.toLowerCase() === 'lecture') {
                return 'Lecture';
            }
            if (!isNaN(word)) {
                return word;
            }
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/Lecture (\d+)/, 'Lecture $1 -');
}

// Helper function to format file name
function formatFileName(fileName) {
    // Remove .pdf extension and format the name
    return fileName
        .replace(/\.pdf$/i, '')
        .replace(/[-_]/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

// Helper function to extract lecture number from path or filename
function extractLectureNumber(text) {
    const match = text.match(/lecture[-\s]?(\d+)|lec[-\s]?(\d+)/i);
    if (match) {
        const num = match[1] || match[2];
        return `lecture-${num}`;
    }
    return 'other';
}

// API endpoint to get PDF structure
app.get('/api/pdfs', async (req, res) => {
    try {
        const files = await scanDirectory(__dirname);
        const structure = categorizePDFs(files);

        // Extract unique lectures dynamically from both notes and slides
        const lectures = new Set();
        files.forEach(file => {
            let lectureNum = extractLectureNumber(file.directory);
            // If not found in directory, try the filename (for slides)
            if (lectureNum === 'other') {
                lectureNum = extractLectureNumber(file.name);
            }
            if (lectureNum !== 'other') {
                lectures.add(lectureNum);
            }
        });

        // Sort lectures numerically by lecture number
        structure.lectures = Array.from(lectures).sort((a, b) => {
            const numA = parseInt(a.replace('lecture-', ''));
            const numB = parseInt(b.replace('lecture-', ''));
            return numA - numB;
        });
        res.json(structure);
    } catch (error) {
        console.error('Error scanning PDFs:', error);
        res.status(500).json({ error: 'Failed to scan PDF files' });
    }
});

// ============================================================================
// DATABASE API ENDPOINTS
// ============================================================================

// History endpoints
app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const history = db.getHistory(limit);
    res.json(history);
});

app.post('/api/history', (req, res) => {
    const { title, path, category, wasSplitView } = req.body;

    if (!title || !path) {
        return res.status(400).json({ error: 'Title and path are required' });
    }

    const result = db.addToHistory(title, path, category, wasSplitView);

    if (result.success) {
        res.json({ success: true });
    } else {
        res.status(500).json(result);
    }
});

app.delete('/api/history', (req, res) => {
    const result = db.clearHistory();

    if (result.success) {
        res.json({ success: true });
    } else {
        res.status(500).json(result);
    }
});

app.delete('/api/history/:path', (req, res) => {
    const path = decodeURIComponent(req.params.path);
    const result = db.deleteHistoryItem(path);

    if (result.success) {
        res.json({ success: true });
    } else {
        res.status(500).json(result);
    }
});

// Cleanup old history
app.post('/api/history/cleanup', (req, res) => {
    const result = db.cleanupOldHistory();

    if (result.success) {
        res.json({ success: true, removed: result.removed });
    } else {
        res.status(500).json(result);
    }
});

// Split companions endpoints
app.post('/api/split-companion', (req, res) => {
    const { leftPath, rightPath } = req.body;

    if (!leftPath || !rightPath) {
        return res.status(400).json({ error: 'Both paths are required' });
    }

    const result = db.saveSplitCompanion(leftPath, rightPath);

    if (result.success) {
        res.json({ success: true });
    } else {
        res.status(500).json(result);
    }
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

    if (result.success) {
        res.json({ success: true });
    } else {
        res.status(500).json(result);
    }
});

// Statistics endpoint
app.get('/api/statistics', (req, res) => {
    const stats = db.getStatistics();

    if (stats) {
        res.json(stats);
    } else {
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// Export data endpoint
app.get('/api/export', (req, res) => {
    const data = db.exportData();

    if (data) {
        res.setHeader('Content-Disposition', 'attachment; filename=pdf-viewer-data.json');
        res.setHeader('Content-Type', 'application/json');
        res.json(data);
    } else {
        res.status(500).json({ error: 'Failed to export data' });
    }
});

// Serve the history page
app.get('/history', (req, res) => {
    res.sendFile(path.join(__dirname, 'history.html'));
});

// Serve the subjects management page
app.get('/subjects.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'subjects.html'));
});

// Serve the upload page
app.get('/upload.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'upload.html'));
});

// ============================================================================
// SUBJECT MANAGEMENT API ENDPOINTS
// ============================================================================

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
    const { name, code, semester, color, icon } = req.body;
    const result = db.createSubject(name, code, semester, color, icon);
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

// ============================================================================
// FILE UPLOAD API ENDPOINT
// ============================================================================

app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const { subject_id, category, lecture_number, custom_name } = req.body;

        // Determine the final destination based on category
        const categoryFolders = {
            'notes': 'notes',
            'slides': 'lecture slides',
            'exercises': 'exercises',
            'exercises-no-solutions': 'exercises-no-solutions',
            'blueprint': 'blueprint',
            'teachers-method': 'teachers-method'
        };

        const categoryFolder = categoryFolders[category] || 'uncategorized';
        const destFolder = path.join(__dirname, categoryFolder);

        // Create destination folder if it doesn't exist
        if (!fsSync.existsSync(destFolder)) {
            await fs.mkdir(destFolder, { recursive: true });
        }

        // Determine final filename
        const finalName = custom_name || req.file.originalname;
        const destPath = path.join(destFolder, finalName);

        // Move file from uploads to destination
        await fs.rename(req.file.path, destPath);

        // Add to database (if needed for tracking)
        // You can add file tracking here if you want

        res.json({
            success: true,
            message: 'File uploaded successfully',
            file: {
                name: finalName,
                path: destPath,
                category: category
            }
        });

    } catch (error) {
        console.error('Upload error:', error);
        // Clean up uploaded file if it exists
        if (req.file && fsSync.existsSync(req.file.path)) {
            await fs.unlink(req.file.path);
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// Serve the main HTML page for all routes (SPA routing)
app.get('*', (req, res, next) => {
    // Skip API routes and static files
    if (req.path.startsWith('/api/') || req.path.match(/\.\w+$/)) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Serving files from: ${__dirname}`);
});

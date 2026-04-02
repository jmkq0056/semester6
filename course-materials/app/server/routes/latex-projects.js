/**
 * LaTeX Projects API Routes
 * Overleaf-like project management for multi-file LaTeX documents
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn } = require('child_process');

// Will be set by the main server
let db = null;
let LATEX_PROJECTS_DIR = null;

// Initialize routes with database and paths
function initRoutes(database, projectsDir) {
    db = database;
    LATEX_PROJECTS_DIR = projectsDir;
}

// ============================================================================
// PROJECT MANAGEMENT
// ============================================================================

// List all projects (including scanning for unregistered ones)
router.get('/', async (req, res) => {
    try {
        // Get all registered projects from database (no user filter)
        let projects = db.getLatexProjects();

        // Scan for unregistered projects on disk
        const unregisteredProjects = await scanForUnregisteredProjects(projects);

        // Auto-register any found unregistered projects
        for (const proj of unregisteredProjects) {
            const result = db.createLatexProject(proj.userId, proj.name, proj.description, proj.path, proj.mainFile);
            if (result.success) {
                projects.push({
                    id: result.projectId,
                    name: proj.name,
                    description: proj.description,
                    path: proj.path,
                    main_file: proj.mainFile,
                    created_at: Date.now(),
                    updated_at: Date.now()
                });
            }
        }

        res.json({ success: true, projects });
    } catch (error) {
        console.error('Error listing projects:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Scan for unregistered projects on disk
async function scanForUnregisteredProjects(registeredProjects) {
    const unregistered = [];
    const registeredPaths = new Set(registeredProjects.map(p => p.path));

    try {
        // Scan the latex-projects directory for user folders
        const entries = await fs.readdir(LATEX_PROJECTS_DIR, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

            const userFolder = entry.name;
            const userPath = path.join(LATEX_PROJECTS_DIR, userFolder);

            // Scan each user folder for projects
            const projectEntries = await fs.readdir(userPath, { withFileTypes: true });

            for (const projectEntry of projectEntries) {
                if (!projectEntry.isDirectory() || projectEntry.name.startsWith('.')) continue;

                const projectPath = `${userFolder}/${projectEntry.name}`;
                const fullProjectPath = path.join(userPath, projectEntry.name);

                // Skip if already registered
                if (registeredPaths.has(projectPath)) continue;

                // Check if it's a valid LaTeX project (has .tex files)
                const hasTexFile = await hasTexFiles(fullProjectPath);
                if (!hasTexFile) continue;

                // Find main file (main.tex or first .tex file)
                const mainFile = await findMainTexFile(fullProjectPath);

                // Create a readable name from folder name
                const projectName = projectEntry.name
                    .replace(/-/g, ' ')
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase());

                unregistered.push({
                    userId: userFolder,
                    name: projectName,
                    description: `Imported from ${projectPath}`,
                    path: projectPath,
                    mainFile: mainFile || 'main.tex'
                });
            }
        }
    } catch (error) {
        console.error('Error scanning for unregistered projects:', error);
    }

    return unregistered;
}

// Check if directory has .tex files
async function hasTexFiles(dirPath) {
    try {
        const entries = await fs.readdir(dirPath);
        return entries.some(e => e.endsWith('.tex'));
    } catch {
        return false;
    }
}

// Find the main .tex file in a project
async function findMainTexFile(dirPath) {
    try {
        const entries = await fs.readdir(dirPath);

        // Prefer main.tex
        if (entries.includes('main.tex')) return 'main.tex';

        // Look for any .tex file
        const texFile = entries.find(e => e.endsWith('.tex'));
        return texFile || null;
    } catch {
        return null;
    }
}

// Create a new project
router.post('/', async (req, res) => {
    try {
        const { name, description, userId = 'default', template = 'basic' } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Project name is required' });
        }

        // Create project folder name from name
        const folderName = name.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .substring(0, 50);

        const projectPath = path.join(userId, folderName);
        const fullPath = path.join(LATEX_PROJECTS_DIR, projectPath);

        // Check if folder exists
        if (fsSync.existsSync(fullPath)) {
            return res.status(409).json({ success: false, error: 'Project folder already exists' });
        }

        // Create project in database
        const result = db.createLatexProject(userId, name, description, projectPath);
        if (!result.success) {
            return res.status(400).json(result);
        }

        // Create project folder structure
        await fs.mkdir(fullPath, { recursive: true });
        await fs.mkdir(path.join(fullPath, 'chapters'), { recursive: true });
        await fs.mkdir(path.join(fullPath, 'figures'), { recursive: true });

        // Create main.tex based on template
        const mainTexContent = getProjectTemplate(template, name);
        await fs.writeFile(path.join(fullPath, 'main.tex'), mainTexContent);

        // Track files in database
        db.addProjectFile(result.projectId, 'main.tex', 'tex', 1);

        // Create sample chapter if using article template
        if (template === 'article' || template === 'thesis') {
            const chapterContent = getChapterTemplate('Introduction');
            await fs.writeFile(path.join(fullPath, 'chapters', 'introduction.tex'), chapterContent);
            db.addProjectFile(result.projectId, 'chapters/introduction.tex', 'tex', 0);
        }

        res.json({
            success: true,
            projectId: result.projectId,
            path: projectPath
        });
    } catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get project details
router.get('/:id', (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }
        res.json({ success: true, project });
    } catch (error) {
        console.error('Error getting project:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update project settings
router.put('/:id', (req, res) => {
    try {
        const result = db.updateLatexProject(req.params.id, req.body);
        res.json(result);
    } catch (error) {
        console.error('Error updating project:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete project
router.delete('/:id', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        // Delete from filesystem
        const fullPath = path.join(LATEX_PROJECTS_DIR, project.path);
        if (fsSync.existsSync(fullPath)) {
            await fs.rm(fullPath, { recursive: true });
        }

        // Delete from database
        const result = db.deleteLatexProject(req.params.id);
        res.json(result);
    } catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// FILE OPERATIONS
// ============================================================================

// Get project file tree
router.get('/:id/files', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const fullPath = path.join(LATEX_PROJECTS_DIR, project.path);
        const tree = await buildFileTree(fullPath, '');

        res.json({ success: true, files: tree, mainFile: project.main_file });
    } catch (error) {
        console.error('Error getting file tree:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Create a new file
router.post('/:id/files', async (req, res) => {
    try {
        const { filePath, content = '', fileType = 'tex' } = req.body;
        const project = db.getLatexProject(req.params.id);

        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        if (!filePath) {
            return res.status(400).json({ success: false, error: 'File path is required' });
        }

        const fullPath = path.join(LATEX_PROJECTS_DIR, project.path, filePath);

        // Security check
        if (!fullPath.startsWith(path.join(LATEX_PROJECTS_DIR, project.path))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Check if file exists
        if (fsSync.existsSync(fullPath)) {
            return res.status(409).json({ success: false, error: 'File already exists' });
        }

        // Create directory if needed
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        // Determine content based on file type
        let fileContent = content;
        if (!content && fileType === 'tex') {
            fileContent = getChapterTemplate(path.basename(filePath, '.tex'));
        }

        await fs.writeFile(fullPath, fileContent);

        // Track in database
        db.addProjectFile(req.params.id, filePath, fileType, 0);

        res.json({ success: true, path: filePath });
    } catch (error) {
        console.error('Error creating file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get file content
router.get('/:id/files/*', async (req, res) => {
    try {
        const filePath = req.params[0];
        const project = db.getLatexProject(req.params.id);

        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const fullPath = path.join(LATEX_PROJECTS_DIR, project.path, filePath);

        // Security check
        if (!fullPath.startsWith(path.join(LATEX_PROJECTS_DIR, project.path))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (!fsSync.existsSync(fullPath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        const content = await fs.readFile(fullPath, 'utf-8');
        res.json({ success: true, content, path: filePath });
    } catch (error) {
        console.error('Error reading file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Save file content
router.put('/:id/files/*', async (req, res) => {
    try {
        const filePath = req.params[0];
        const { content } = req.body;
        const project = db.getLatexProject(req.params.id);

        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const fullPath = path.join(LATEX_PROJECTS_DIR, project.path, filePath);

        // Security check
        if (!fullPath.startsWith(path.join(LATEX_PROJECTS_DIR, project.path))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        await fs.writeFile(fullPath, content);

        // Update modification time in database
        db.updateProjectFileModified(req.params.id, filePath);

        res.json({ success: true });
    } catch (error) {
        console.error('Error saving file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete file
router.delete('/:id/files/*', async (req, res) => {
    try {
        const filePath = req.params[0];
        const project = db.getLatexProject(req.params.id);

        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        // Prevent deleting main file
        if (filePath === project.main_file) {
            return res.status(400).json({ success: false, error: 'Cannot delete main file' });
        }

        const fullPath = path.join(LATEX_PROJECTS_DIR, project.path, filePath);

        // Security check
        if (!fullPath.startsWith(path.join(LATEX_PROJECTS_DIR, project.path))) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        if (fsSync.existsSync(fullPath)) {
            await fs.unlink(fullPath);
        }

        // Remove from database
        db.removeProjectFile(req.params.id, filePath);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Rename file
router.post('/:id/files/rename', async (req, res) => {
    try {
        const { oldPath, newPath } = req.body;
        const project = db.getLatexProject(req.params.id);

        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const oldFullPath = path.join(LATEX_PROJECTS_DIR, project.path, oldPath);
        const newFullPath = path.join(LATEX_PROJECTS_DIR, project.path, newPath);

        // Security check
        const basePath = path.join(LATEX_PROJECTS_DIR, project.path);
        if (!oldFullPath.startsWith(basePath) || !newFullPath.startsWith(basePath)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Create new directory if needed
        await fs.mkdir(path.dirname(newFullPath), { recursive: true });

        await fs.rename(oldFullPath, newFullPath);

        // Update database
        db.removeProjectFile(req.params.id, oldPath);
        const fileType = path.extname(newPath).slice(1) || 'tex';
        db.addProjectFile(req.params.id, newPath, fileType, oldPath === project.main_file ? 1 : 0);

        // Update main file if renamed
        if (oldPath === project.main_file) {
            db.updateLatexProject(req.params.id, { main_file: newPath });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error renaming file:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// COMPILATION
// ============================================================================

// Compile project
router.post('/:id/compile', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const mainFile = project.main_file;
        const compiler = project.compiler || 'pdflatex';

        // Run compilation
        const result = await compileLatexProject(projectDir, mainFile, compiler);

        // Auto-commit after successful compilation (non-blocking)
        if (result.success) {
            autoCommitAfterCompile(projectDir, project.name)
                .then(commitResult => {
                    if (commitResult.success && commitResult.message) {
                        console.log(`[Git] ${project.name}: ${commitResult.message}`);
                    }
                })
                .catch(err => {
                    console.error(`[Git] Auto-commit error for ${project.name}:`, err.message);
                });
        }

        res.json(result);
    } catch (error) {
        console.error('Error compiling project:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get compilation output/logs
router.get('/:id/output', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const logFile = path.join(LATEX_PROJECTS_DIR, project.path, project.main_file.replace('.tex', '.log'));

        if (fsSync.existsSync(logFile)) {
            const log = await fs.readFile(logFile, 'utf-8');
            res.json({ success: true, log });
        } else {
            res.json({ success: true, log: 'No compilation log found' });
        }
    } catch (error) {
        console.error('Error getting compilation output:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get compiled PDF path
router.get('/:id/pdf', (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const pdfFile = project.main_file.replace('.tex', '.pdf');
        const pdfPath = `/latex-projects/${project.path}/${pdfFile}`;
        const fullPath = path.join(LATEX_PROJECTS_DIR, project.path, pdfFile);

        if (fsSync.existsSync(fullPath)) {
            res.json({ success: true, pdfPath, exists: true });
        } else {
            res.json({ success: true, pdfPath, exists: false });
        }
    } catch (error) {
        console.error('Error getting PDF path:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// YOUTUBE REFERENCES
// ============================================================================

// Add YouTube reference
router.post('/:id/youtube', (req, res) => {
    try {
        const { filePath, videoId, videoTitle, timestampSeconds, note } = req.body;
        const result = db.addProjectYoutubeRef(
            req.params.id,
            filePath || '',
            videoId,
            videoTitle || '',
            timestampSeconds || 0,
            note || ''
        );
        res.json(result);
    } catch (error) {
        console.error('Error adding YouTube reference:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get YouTube references
router.get('/:id/youtube', (req, res) => {
    try {
        const refs = db.getProjectYoutubeRefs(req.params.id);
        res.json({ success: true, references: refs });
    } catch (error) {
        console.error('Error getting YouTube references:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete YouTube reference
router.delete('/:id/youtube/:refId', (req, res) => {
    try {
        const result = db.deleteProjectYoutubeRef(req.params.refId);
        res.json(result);
    } catch (error) {
        console.error('Error deleting YouTube reference:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// VERSION CONTROL
// ============================================================================

// Save version snapshot
router.post('/:id/versions', (req, res) => {
    try {
        const { summary, source = 'user' } = req.body;
        const versionNumber = db.getNextProjectVersionNumber(req.params.id);

        // Get all project files for snapshot
        const project = db.getLatexProject(req.params.id);
        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);

        // Read all tex files
        const snapshot = {};
        const files = db.getProjectFiles(req.params.id);

        files.forEach(file => {
            const fullPath = path.join(projectDir, file.file_path);
            if (fsSync.existsSync(fullPath)) {
                try {
                    snapshot[file.file_path] = fsSync.readFileSync(fullPath, 'utf-8');
                } catch (e) {
                    // Skip binary files
                }
            }
        });

        const result = db.saveProjectVersion(req.params.id, versionNumber, snapshot, summary, source);
        res.json({ ...result, versionNumber });
    } catch (error) {
        console.error('Error saving version:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get versions list
router.get('/:id/versions', (req, res) => {
    try {
        const versions = db.getProjectVersions(req.params.id);
        res.json({ success: true, versions });
    } catch (error) {
        console.error('Error getting versions:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get specific version data
router.get('/:id/versions/:versionId', (req, res) => {
    try {
        const version = db.getProjectVersionData(req.params.versionId);
        if (!version) {
            return res.status(404).json({ success: false, error: 'Version not found' });
        }
        res.json({ success: true, version });
    } catch (error) {
        console.error('Error getting version data:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Restore version
router.post('/:id/versions/:versionId/restore', async (req, res) => {
    try {
        const version = db.getProjectVersionData(req.params.versionId);
        if (!version) {
            return res.status(404).json({ success: false, error: 'Version not found' });
        }

        const project = db.getLatexProject(req.params.id);
        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);

        // Save current state as new version first
        const currentSnapshot = {};
        const files = db.getProjectFiles(req.params.id);
        files.forEach(file => {
            const fullPath = path.join(projectDir, file.file_path);
            if (fsSync.existsSync(fullPath)) {
                try {
                    currentSnapshot[file.file_path] = fsSync.readFileSync(fullPath, 'utf-8');
                } catch (e) {}
            }
        });

        const backupVersion = db.getNextProjectVersionNumber(req.params.id);
        db.saveProjectVersion(req.params.id, backupVersion, currentSnapshot, 'Auto-backup before restore', 'system');

        // Restore files from version
        for (const [filePath, content] of Object.entries(version.snapshot_data)) {
            const fullPath = path.join(projectDir, filePath);
            await fs.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.writeFile(fullPath, content);
        }

        res.json({ success: true, backupVersion });
    } catch (error) {
        console.error('Error restoring version:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Build file tree recursively
async function buildFileTree(dirPath, relativePath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const tree = [];

    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden files
        if (entry.name.endsWith('.aux') || entry.name.endsWith('.log') ||
            entry.name.endsWith('.out') || entry.name.endsWith('.toc') ||
            entry.name.endsWith('.synctex.gz')) continue; // Skip LaTeX temp files

        const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            const children = await buildFileTree(fullPath, entryPath);
            tree.push({
                name: entry.name,
                path: entryPath,
                type: 'folder',
                children
            });
        } else {
            const ext = path.extname(entry.name).slice(1).toLowerCase();
            tree.push({
                name: entry.name,
                path: entryPath,
                type: 'file',
                fileType: ext || 'txt'
            });
        }
    }

    // Sort: folders first, then files alphabetically
    tree.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.name.localeCompare(b.name);
    });

    return tree;
}

// Compile LaTeX project
function compileLatexProject(projectDir, mainFile, compiler) {
    return new Promise((resolve) => {
        const args = [
            '-interaction=nonstopmode',
            '-file-line-error',
            mainFile
        ];

        const process = spawn(compiler, args, {
            cwd: projectDir,
            env: { ...global.process.env, PATH: global.process.env.PATH }
        });

        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => { stdout += data.toString(); });
        process.stderr.on('data', (data) => { stderr += data.toString(); });

        process.on('close', (code) => {
            const pdfFile = mainFile.replace('.tex', '.pdf');
            const pdfPath = path.join(projectDir, pdfFile);
            const pdfExists = fsSync.existsSync(pdfPath);

            // Run twice for references
            if (pdfExists && (stdout.includes('Rerun') || stdout.includes('Label(s) may have changed'))) {
                const secondRun = spawn(compiler, args, { cwd: projectDir });
                secondRun.on('close', () => {
                    resolve({
                        success: true,
                        pdfPath: `/latex-projects/${path.relative(LATEX_PROJECTS_DIR, pdfPath).replace(/\\/g, '/')}`,
                        log: stdout,
                        hadWarnings: stdout.includes('Warning')
                    });
                });
            } else if (pdfExists) {
                resolve({
                    success: true,
                    pdfPath: `/latex-projects/${path.relative(LATEX_PROJECTS_DIR, pdfPath).replace(/\\/g, '/')}`,
                    log: stdout,
                    hadWarnings: stdout.includes('Warning')
                });
            } else {
                resolve({
                    success: false,
                    error: 'Compilation failed - no PDF generated',
                    log: stdout + '\n' + stderr
                });
            }
        });

        process.on('error', (err) => {
            resolve({ success: false, error: err.message });
        });
    });
}

// Project templates
function getProjectTemplate(template, title) {
    const templates = {
        basic: `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{geometry}
\\usepackage{hyperref}

\\geometry{a4paper, margin=1in}

\\title{${title}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Your content here.

\\end{document}
`,
        article: `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{geometry}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{tcolorbox}
\\usepackage{xcolor}

\\geometry{a4paper, margin=1in}

\\title{${title}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle
\\tableofcontents
\\newpage

\\input{chapters/introduction}

\\end{document}
`,
        thesis: `\\documentclass[12pt,a4paper,twoside]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{geometry}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{setspace}

\\geometry{a4paper, margin=1in}
\\onehalfspacing

\\title{${title}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
Your abstract here.
\\end{abstract}

\\tableofcontents
\\listoffigures
\\listoftables

\\chapter{Introduction}
\\input{chapters/introduction}

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`,
        beamer: `\\documentclass{beamer}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}

\\usetheme{Madrid}
\\usecolortheme{default}

\\title{${title}}
\\author{}
\\date{\\today}

\\begin{document}

\\frame{\\titlepage}

\\begin{frame}
\\frametitle{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}
\\begin{frame}
\\frametitle{Introduction}
Your content here.
\\end{frame}

\\end{document}
`
    };

    return templates[template] || templates.basic;
}

function getChapterTemplate(title) {
    return `% ${title}
% This file is included in main.tex

\\section{${title}}

Your content here.
`;
}

// ============================================================================
// GIT VERSION CONTROL
// ============================================================================

// Execute git command in project directory
function execGit(projectDir, args) {
    return new Promise((resolve, reject) => {
        const git = spawn('git', args, {
            cwd: projectDir,
            env: { ...global.process.env }
        });

        let stdout = '';
        let stderr = '';

        git.stdout.on('data', (data) => { stdout += data.toString(); });
        git.stderr.on('data', (data) => { stderr += data.toString(); });

        git.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, output: stdout.trim() });
            } else {
                // Some git commands return non-zero but aren't errors
                resolve({ success: false, output: stdout.trim(), error: stderr.trim(), code });
            }
        });

        git.on('error', (err) => {
            reject(err);
        });
    });
}

// Execute gh (GitHub CLI) command in project directory
function execGh(projectDir, args) {
    return new Promise((resolve, reject) => {
        const gh = spawn('gh', args, {
            cwd: projectDir,
            env: { ...global.process.env }
        });

        let stdout = '';
        let stderr = '';

        gh.stdout.on('data', (data) => { stdout += data.toString(); });
        gh.stderr.on('data', (data) => { stderr += data.toString(); });

        gh.on('close', (code) => {
            if (code === 0) {
                resolve({ success: true, output: stdout.trim() });
            } else {
                resolve({ success: false, output: stdout.trim(), error: stderr.trim(), code });
            }
        });

        gh.on('error', (err) => {
            reject(err);
        });
    });
}

// Check if gh CLI is authenticated
async function isGhAuthenticated() {
    try {
        const result = await execGh('.', ['auth', 'status']);
        // gh auth status outputs to stderr even when successful
        return result.success || (result.error && result.error.includes('Logged in'));
    } catch (e) {
        return false;
    }
}

// Get GitHub username
async function getGhUsername() {
    try {
        const result = await execGh('.', ['api', 'user', '-q', '.login']);
        if (result.success && result.output) {
            return result.output.trim();
        }
        return null;
    } catch (e) {
        return null;
    }
}

// Check if project has git initialized
async function isGitInitialized(projectDir) {
    try {
        const gitDir = path.join(projectDir, '.git');
        await fs.access(gitDir);
        return true;
    } catch {
        return false;
    }
}

// Auto-commit changes after compile (called internally)
async function autoCommitAfterCompile(projectDir, projectName) {
    try {
        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) return { success: false, reason: 'Git not initialized' };

        // Check if there are changes to commit
        const status = await execGit(projectDir, ['status', '--porcelain']);
        if (!status.output || status.output.trim() === '') {
            return { success: true, reason: 'No changes to commit' };
        }

        // Add all changes (excluding common temp files via .gitignore)
        await execGit(projectDir, ['add', '-A']);

        // Create commit with timestamp
        const timestamp = new Date().toLocaleString();
        const message = `Auto-save: Compiled at ${timestamp}`;
        const result = await execGit(projectDir, ['commit', '-m', message]);

        if (result.success) {
            return { success: true, message: 'Changes committed', output: result.output };
        } else {
            // No changes to commit is not an error
            if (result.output.includes('nothing to commit')) {
                return { success: true, reason: 'No changes to commit' };
            }
            return { success: false, error: result.error || result.output };
        }
    } catch (error) {
        console.error('Auto-commit error:', error);
        return { success: false, error: error.message };
    }
}

// Initialize git for a project AND create GitHub repo automatically
router.post('/:id/git/init', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const repoName = `latex-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

        // Check if already initialized
        const hasGit = await isGitInitialized(projectDir);

        // Check if gh is authenticated
        const ghAuth = await isGhAuthenticated();
        if (!ghAuth) {
            return res.status(400).json({
                success: false,
                error: 'GitHub CLI not authenticated. Run "gh auth login" in terminal first.'
            });
        }

        if (!hasGit) {
            // Initialize git
            const initResult = await execGit(projectDir, ['init']);
            if (!initResult.success) {
                return res.status(500).json({ success: false, error: initResult.error });
            }

            // Create .gitignore for LaTeX projects
            const gitignore = `# LaTeX auxiliary files
*.aux
*.log
*.out
*.toc
*.lof
*.lot
*.fls
*.fdb_latexmk
*.synctex.gz
*.bbl
*.blg
*.nav
*.snm
*.vrb

# Output files (keep PDFs in git for version comparison)
# *.pdf

# Editor backups
*~
*.swp
*.bak
.DS_Store
`;
            await fs.writeFile(path.join(projectDir, '.gitignore'), gitignore);

            // Initial commit
            await execGit(projectDir, ['add', '-A']);
            await execGit(projectDir, ['commit', '-m', 'Initial commit: Project created']);
        }

        // Check if remote already exists
        const remotes = await execGit(projectDir, ['remote', '-v']);
        let repoUrl = null;

        if (!remotes.output || !remotes.output.includes('origin')) {
            // Create GitHub repo using gh CLI (private by default)
            const createResult = await execGh(projectDir, [
                'repo', 'create', repoName,
                '--private',
                '--source=.',
                '--remote=origin',
                '--push'
            ]);

            if (createResult.success) {
                repoUrl = createResult.output;
            } else if (createResult.error && createResult.error.includes('already exists')) {
                // Repo already exists, try to add it as remote
                const username = await getGhUsername();
                if (username) {
                    repoUrl = `https://github.com/${username}/${repoName}.git`;
                    await execGit(projectDir, ['remote', 'add', 'origin', repoUrl]);
                    // Push to existing repo
                    await execGit(projectDir, ['push', '-u', 'origin', 'main']);
                }
            } else {
                // Log error but don't fail - local git is still working
                console.error('GitHub repo creation failed:', createResult.error);
            }
        } else {
            // Remote exists, just push
            const branch = await execGit(projectDir, ['branch', '--show-current']);
            const branchName = branch.output || 'main';
            await execGit(projectDir, ['push', '-u', 'origin', branchName]);

            // Extract repo URL from remote
            const urlMatch = remotes.output.match(/origin\s+(\S+)/);
            if (urlMatch) repoUrl = urlMatch[1];
        }

        res.json({
            success: true,
            message: repoUrl ? `Git initialized and pushed to GitHub` : 'Git initialized locally',
            repoUrl,
            repoName
        });
    } catch (error) {
        console.error('Git init error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get git status
router.get('/:id/git/status', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            // Check if gh is authenticated for the button text
            const ghAuth = await isGhAuthenticated();
            return res.json({ success: true, initialized: false, ghAuthenticated: ghAuth });
        }

        const status = await execGit(projectDir, ['status', '--porcelain']);
        const branch = await execGit(projectDir, ['branch', '--show-current']);

        // Check if there's a remote and get its URL
        const remotes = await execGit(projectDir, ['remote', '-v']);
        const hasRemote = remotes.output && remotes.output.trim().length > 0;
        let repoUrl = null;
        if (hasRemote) {
            const urlMatch = remotes.output.match(/origin\s+(\S+)/);
            if (urlMatch) repoUrl = urlMatch[1];
        }

        // Check ahead/behind if remote exists
        let ahead = 0, behind = 0;
        if (hasRemote) {
            try {
                await execGit(projectDir, ['fetch', '--dry-run']);
                const aheadBehind = await execGit(projectDir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
                if (aheadBehind.success && aheadBehind.output) {
                    const parts = aheadBehind.output.trim().split(/\s+/);
                    ahead = parseInt(parts[0]) || 0;
                    behind = parseInt(parts[1]) || 0;
                }
            } catch (e) {
                // No upstream set
            }
        }

        res.json({
            success: true,
            initialized: true,
            branch: branch.output || 'main',
            hasChanges: status.output && status.output.trim().length > 0,
            changes: status.output ? status.output.trim().split('\n').filter(l => l) : [],
            hasRemote,
            repoUrl,
            ahead,
            behind
        });
    } catch (error) {
        console.error('Git status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get git log (commit history)
router.get('/:id/git/log', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const limit = parseInt(req.query.limit) || 50;

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.json({ success: true, initialized: false, commits: [] });
        }

        // Get log with format: hash|author|date|message
        const logResult = await execGit(projectDir, [
            'log',
            `--max-count=${limit}`,
            '--format=%H|%an|%aI|%s'
        ]);

        if (!logResult.success || !logResult.output) {
            return res.json({ success: true, initialized: true, commits: [] });
        }

        const commits = logResult.output.trim().split('\n').filter(l => l).map(line => {
            const [hash, author, date, ...messageParts] = line.split('|');
            return {
                hash,
                shortHash: hash.substring(0, 7),
                author,
                date,
                message: messageParts.join('|'),
                isAutoSave: messageParts.join('|').startsWith('Auto-save:')
            };
        });

        res.json({ success: true, initialized: true, commits });
    } catch (error) {
        console.error('Git log error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Manual commit
router.post('/:id/git/commit', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const { message } = req.body;

        if (!message || message.trim() === '') {
            return res.status(400).json({ success: false, error: 'Commit message required' });
        }

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.status(400).json({ success: false, error: 'Git not initialized. Initialize first.' });
        }

        // Add all changes
        await execGit(projectDir, ['add', '-A']);

        // Commit
        const result = await execGit(projectDir, ['commit', '-m', message.trim()]);

        if (result.success) {
            res.json({ success: true, message: 'Changes committed', output: result.output });
        } else if (result.output && result.output.includes('nothing to commit')) {
            res.json({ success: true, message: 'No changes to commit' });
        } else {
            res.status(400).json({ success: false, error: result.error || 'Commit failed' });
        }
    } catch (error) {
        console.error('Git commit error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Set remote URL
router.post('/:id/git/remote', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'Remote URL required' });
        }

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.status(400).json({ success: false, error: 'Git not initialized' });
        }

        // Check if remote exists
        const remotes = await execGit(projectDir, ['remote']);
        if (remotes.output && remotes.output.includes('origin')) {
            // Update existing remote
            await execGit(projectDir, ['remote', 'set-url', 'origin', url]);
        } else {
            // Add new remote
            await execGit(projectDir, ['remote', 'add', 'origin', url]);
        }

        res.json({ success: true, message: 'Remote URL set' });
    } catch (error) {
        console.error('Git remote error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Push to remote (auto-creates GitHub repo if needed)
router.post('/:id/git/push', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const { force } = req.body;
        const repoName = `latex-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.status(400).json({ success: false, error: 'Git not initialized' });
        }

        // Check if remote exists
        let remotes = await execGit(projectDir, ['remote', '-v']);
        let repoUrl = null;

        if (!remotes.output || !remotes.output.includes('origin')) {
            // No remote - auto-create GitHub repo
            const ghAuth = await isGhAuthenticated();
            if (!ghAuth) {
                return res.status(400).json({
                    success: false,
                    error: 'GitHub CLI not authenticated. Run "gh auth login" in terminal first.'
                });
            }

            // Create GitHub repo using gh CLI
            const createResult = await execGh(projectDir, [
                'repo', 'create', repoName,
                '--private',
                '--source=.',
                '--remote=origin',
                '--push'
            ]);

            if (createResult.success) {
                repoUrl = createResult.output;
                return res.json({
                    success: true,
                    message: 'Created GitHub repo and pushed',
                    repoUrl,
                    repoName
                });
            } else if (createResult.error && createResult.error.includes('already exists')) {
                // Repo exists, add as remote
                const username = await getGhUsername();
                if (username) {
                    repoUrl = `https://github.com/${username}/${repoName}.git`;
                    await execGit(projectDir, ['remote', 'add', 'origin', repoUrl]);
                }
            } else {
                return res.status(400).json({
                    success: false,
                    error: createResult.error || 'Failed to create GitHub repo'
                });
            }
        }

        // Get current branch
        const branch = await execGit(projectDir, ['branch', '--show-current']);
        const branchName = branch.output || 'main';

        // Push
        const args = ['push', '-u', 'origin', branchName];
        if (force) args.push('--force');

        const result = await execGit(projectDir, args);

        // Get repo URL for response
        if (!repoUrl) {
            remotes = await execGit(projectDir, ['remote', '-v']);
            const urlMatch = remotes.output && remotes.output.match(/origin\s+(\S+)/);
            if (urlMatch) repoUrl = urlMatch[1];
        }

        if (result.success) {
            res.json({ success: true, message: 'Pushed to remote', output: result.output, repoUrl });
        } else {
            // Check for common errors
            if (result.error && result.error.includes('rejected')) {
                res.status(400).json({
                    success: false,
                    error: 'Push rejected. Pull changes first or use force push.',
                    needsForce: true
                });
            } else {
                res.status(400).json({ success: false, error: result.error || 'Push failed' });
            }
        }
    } catch (error) {
        console.error('Git push error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Pull from remote
router.post('/:id/git/pull', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.status(400).json({ success: false, error: 'Git not initialized' });
        }

        const result = await execGit(projectDir, ['pull']);

        if (result.success) {
            res.json({ success: true, message: 'Pulled from remote', output: result.output });
        } else {
            res.status(400).json({ success: false, error: result.error || 'Pull failed' });
        }
    } catch (error) {
        console.error('Git pull error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get diff for a specific commit
router.get('/:id/git/diff/:hash', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const { hash } = req.params;

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.status(400).json({ success: false, error: 'Git not initialized' });
        }

        // Get diff between this commit and its parent
        const diff = await execGit(projectDir, ['diff', `${hash}^`, hash, '--stat']);
        const fullDiff = await execGit(projectDir, ['diff', `${hash}^`, hash]);

        res.json({
            success: true,
            summary: diff.output,
            diff: fullDiff.output
        });
    } catch (error) {
        console.error('Git diff error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Checkout (rollback) to specific commit
router.post('/:id/git/checkout', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const { hash, createBranch } = req.body;

        if (!hash) {
            return res.status(400).json({ success: false, error: 'Commit hash required' });
        }

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.status(400).json({ success: false, error: 'Git not initialized' });
        }

        // First, commit any uncommitted changes
        const status = await execGit(projectDir, ['status', '--porcelain']);
        if (status.output && status.output.trim()) {
            await execGit(projectDir, ['add', '-A']);
            await execGit(projectDir, ['commit', '-m', `Auto-save before rollback to ${hash.substring(0, 7)}`]);
        }

        if (createBranch) {
            // Create a new branch from this commit
            const branchName = `rollback-${hash.substring(0, 7)}-${Date.now()}`;
            const result = await execGit(projectDir, ['checkout', '-b', branchName, hash]);
            if (result.success) {
                res.json({ success: true, message: `Created branch ${branchName}`, branch: branchName });
            } else {
                res.status(400).json({ success: false, error: result.error });
            }
        } else {
            // Hard reset to the commit (warning: this is destructive!)
            // First, create a backup branch
            const backupBranch = `backup-${Date.now()}`;
            await execGit(projectDir, ['branch', backupBranch]);

            // Reset to the commit
            const result = await execGit(projectDir, ['reset', '--hard', hash]);
            if (result.success) {
                res.json({
                    success: true,
                    message: `Rolled back to ${hash.substring(0, 7)}`,
                    backupBranch
                });
            } else {
                res.status(400).json({ success: false, error: result.error });
            }
        }
    } catch (error) {
        console.error('Git checkout error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get file content at specific commit
router.get('/:id/git/show/:hash/*', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);
        const { hash } = req.params;
        const filePath = req.params[0]; // Everything after the hash

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.status(400).json({ success: false, error: 'Git not initialized' });
        }

        const result = await execGit(projectDir, ['show', `${hash}:${filePath}`]);

        if (result.success) {
            res.json({ success: true, content: result.output });
        } else {
            res.status(404).json({ success: false, error: 'File not found at this commit' });
        }
    } catch (error) {
        console.error('Git show error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// List branches
router.get('/:id/git/branches', async (req, res) => {
    try {
        const project = db.getLatexProject(req.params.id);
        if (!project) {
            return res.status(404).json({ success: false, error: 'Project not found' });
        }

        const projectDir = path.join(LATEX_PROJECTS_DIR, project.path);

        const hasGit = await isGitInitialized(projectDir);
        if (!hasGit) {
            return res.json({ success: true, initialized: false, branches: [] });
        }

        const result = await execGit(projectDir, ['branch', '-a', '--format=%(refname:short)|%(objectname:short)|%(HEAD)']);
        const current = await execGit(projectDir, ['branch', '--show-current']);

        const branches = result.output ? result.output.trim().split('\n').map(line => {
            const [name, hash, isCurrent] = line.split('|');
            return { name, hash, isCurrent: isCurrent === '*' };
        }) : [];

        res.json({
            success: true,
            initialized: true,
            currentBranch: current.output,
            branches
        });
    } catch (error) {
        console.error('Git branches error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export the autoCommitAfterCompile function for use in compile route
const gitHelpers = { autoCommitAfterCompile, isGitInitialized };

module.exports = { router, initRoutes, gitHelpers };

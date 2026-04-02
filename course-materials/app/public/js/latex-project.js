/**
 * LaTeX Project Manager
 * Overleaf-like multi-file LaTeX project editor
 */

// ============================================================================
// GLOBAL STATE
// ============================================================================

let currentProject = null;
let currentProjectId = null;
let editor = null;
let fileTree = null;
let tabManager = null;
let isModified = false;
let isCompiling = false;
let currentPdfPath = null;

// Claude AI state (matching tex-editor.js)
let claudeMode = 'file'; // 'selection' or 'file'
let claudeCodeSelections = []; // Multiple code selections with metadata
let selectionIdCounter = 0; // Unique ID for each selection

// Claude @ file references
let claudeReferencedFiles = []; // Referenced files with content
let claudeProjectFiles = []; // Available files for autocomplete
let claudeAutocompleteIndex = -1; // Autocomplete navigation

// Claude AI sidepanel state
let isClaudeAIPanelOpen = false;
let claudePastedImages = []; // Pasted images as base64
let claudeYoutubeTranscripts = []; // YouTube transcripts

// Edit state machine
const ClaudeEditState = {
    IDLE: 'idle',
    RUNNING: 'running',
    REVIEWING: 'reviewing',
    COMPILING: 'compiling'
};
let claudeEditState = ClaudeEditState.IDLE;
let isClaudeRunning = false;

// Backup for revert
let claudeEditBackup = {
    originalContent: null,
    originalPdfPath: null,
    filePath: null
};

// Track current Claude action
let claudeCurrentAction = null;
let claudeCurrentCustomPrompt = '';

// Auto-save debounce
let autoSaveTimeout = null;
const AUTO_SAVE_DELAY = 2000;

// Auto-compile debounce
let autoCompileTimeout = null;
const AUTO_COMPILE_DELAY = 3000;

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initializeEditor();
    initializeFileTree();
    initializeTabManager();
    initializeResizers();
    initializeKeyboardShortcuts();
    loadProjects();

    // Check URL for project ID
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');
    if (projectId) {
        loadProject(projectId);
    }
});

function initializeEditor() {
    const textarea = document.getElementById('code-editor');
    if (!textarea) return;

    editor = CodeMirror.fromTextArea(textarea, {
        mode: 'stex',
        theme: 'material-darker',
        lineNumbers: true,
        lineWrapping: true,
        foldGutter: true,
        gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
        matchBrackets: true,
        autoCloseBrackets: true,
        indentUnit: 4,
        tabSize: 4,
        indentWithTabs: false,
        extraKeys: {
            'Cmd-S': () => saveCurrentFile(),
            'Ctrl-S': () => saveCurrentFile(),
            'Cmd-B': () => compileProject(),
            'Ctrl-B': () => compileProject(),
            'Cmd-E': () => toggleClaudePanel(),
            'Ctrl-E': () => toggleClaudePanel(),
            'Cmd-/': 'toggleComment',
            'Ctrl-/': 'toggleComment'
        }
    });

    // Track modifications
    editor.on('change', () => {
        if (!isModified) {
            isModified = true;
            updateEditorStatus('modified', 'Modified');
            if (tabManager && tabManager.getCurrentTab()) {
                tabManager.setModified(tabManager.getCurrentTab(), true);
            }
        }

        // Auto-save
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            if (isModified && currentProjectId) {
                saveCurrentFile(true); // Silent save
            }
        }, AUTO_SAVE_DELAY);

        // Auto-compile
        if (currentProject && currentProject.auto_compile) {
            clearTimeout(autoCompileTimeout);
            autoCompileTimeout = setTimeout(() => {
                if (currentProjectId) {
                    compileProject(true); // Silent compile
                }
            }, AUTO_COMPILE_DELAY);
        }

        // Update outline
        updateDocumentOutline();
    });

    // Track selection for Claude
    editor.on('cursorActivity', () => {
        updateClaudeSelectionInfo();
    });
}

function initializeFileTree() {
    fileTree = new FileTree('file-tree', {
        onFileSelect: (path, fileType) => {
            openFile(path);
        },
        onFileContextMenu: (event, item) => {
            showFileContextMenu(event, item);
        },
        onFolderToggle: (path, expanded) => {
            // Could persist folder state
        }
    });
}

function initializeTabManager() {
    tabManager = new TabManager('editor-tabs', {
        onTabSwitch: (path, content, fileType, previousTab, metadata = {}) => {
            // Get previous tab's metadata to check if it was a special viewer
            const prevMetadata = previousTab ? tabManager.getTabMetadata(previousTab) : {};

            // Save current editor content to PREVIOUS tab (only if it was a code file)
            if (previousTab && editor && !prevMetadata.isSpecialViewer) {
                tabManager.updateTabContent(previousTab, editor.getValue());
            }

            // Check if new tab needs a special viewer
            if (metadata.isSpecialViewer) {
                const fileName = path.split('/').pop();

                if (metadata.viewerType === 'image') {
                    showFileViewer('image', metadata.rawUrl, fileName, fileType);
                } else if (metadata.viewerType === 'markdown') {
                    showFileViewer('markdown', content, fileName, fileType);
                } else {
                    showFileViewer(metadata.viewerType, content, fileName, fileType);
                }
                updateEditorStatus('ready', 'Viewing');
            } else {
                // Regular code file - show CodeMirror
                showCodeEditor();

                if (editor) {
                    editor.setValue(content);
                    isModified = false;
                    updateEditorStatus('ready', 'Ready');
                }
            }

            // Update file tree selection
            if (fileTree) {
                fileTree.highlightFile(path);
            }
        },
        onTabClose: (path) => {
            // Tab closed - show editor if viewer was showing
            showCodeEditor();
        },
        onAllTabsClosed: () => {
            showCodeEditor();
            if (editor) {
                editor.setValue('');
            }
            updateEditorStatus('ready', 'No file open');
        }
    });
}

function initializeResizers() {
    // Sidebar resizer
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const sidebar = document.getElementById('file-tree-sidebar');

    if (sidebarResizer && sidebar) {
        let isResizing = false;

        sidebarResizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = e.clientX;
            if (newWidth > 150 && newWidth < 500) {
                sidebar.style.width = `${newWidth}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = '';
        });
    }

    // PDF resizer
    const pdfResizer = document.getElementById('pdf-resizer');
    const pdfPanel = document.getElementById('pdf-preview-panel');

    if (pdfResizer && pdfPanel) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        pdfResizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = pdfPanel.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // Dragging left = making panel wider, dragging right = making panel smaller
            const deltaX = startX - e.clientX;
            const newWidth = startWidth + deltaX;
            if (newWidth >= 200 && newWidth <= 800) {
                pdfPanel.style.width = `${newWidth}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
}

function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Escape to close panels
        if (e.key === 'Escape') {
            const claudePanel = document.getElementById('claude-panel');
            const versionPanel = document.getElementById('version-panel');

            if (claudePanel.classList.contains('open')) {
                toggleClaudePanel();
            } else if (versionPanel.classList.contains('open')) {
                toggleVersionPanel();
            }
        }
    });
}

// ============================================================================
// PROJECT MANAGEMENT
// ============================================================================

async function loadProjects() {
    try {
        const response = await fetch('/api/latex-projects');
        const data = await response.json();

        if (data.success) {
            const dropdown = document.getElementById('project-dropdown');
            dropdown.innerHTML = '<option value="">Select a project...</option>';

            // Group projects by user_id
            const projectsByUser = {};
            data.projects.forEach(project => {
                const userId = project.user_id || 'default';
                if (!projectsByUser[userId]) {
                    projectsByUser[userId] = [];
                }
                projectsByUser[userId].push(project);
            });

            // Create optgroups for each user
            Object.keys(projectsByUser).sort().forEach(userId => {
                const optgroup = document.createElement('optgroup');
                optgroup.label = userId === 'default' ? 'My Projects' : `${userId}'s Projects`;

                projectsByUser[userId].forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = project.name;
                    optgroup.appendChild(option);
                });

                dropdown.appendChild(optgroup);
            });
        }
    } catch (error) {
        console.error('Error loading projects:', error);
        showNotification('Failed to load projects', 'error');
    }
}

async function loadProject(projectId) {
    try {
        // Get project details
        const projectResponse = await fetch(`/api/latex-projects/${projectId}`);
        const projectData = await projectResponse.json();

        if (!projectData.success) {
            showNotification('Project not found', 'error');
            return;
        }

        currentProject = projectData.project;
        currentProjectId = projectId;

        // Update UI
        document.getElementById('project-name').textContent = currentProject.name;
        document.getElementById('project-dropdown').value = projectId;

        // Update URL
        const url = new URL(window.location);
        url.searchParams.set('project', projectId);
        window.history.pushState({}, '', url);

        // Load file tree
        await refreshFileTree();

        // Load PDF if exists
        await checkForPdf();

        // Load YouTube references
        await loadYoutubeRefs();

        // Open main file
        await openFile(currentProject.main_file);

        showNotification(`Loaded project: ${currentProject.name}`, 'success');
    } catch (error) {
        console.error('Error loading project:', error);
        showNotification('Failed to load project', 'error');
    }
}

function switchProject(projectId) {
    if (!projectId) return;

    // Check for unsaved changes
    if (tabManager && tabManager.hasUnsavedChanges()) {
        if (!confirm('You have unsaved changes. Switch project anyway?')) {
            document.getElementById('project-dropdown').value = currentProjectId || '';
            return;
        }
    }

    loadProject(projectId);
}

function openNewProjectModal() {
    document.getElementById('new-project-modal').classList.add('visible');
    document.getElementById('project-name-input').focus();
}

function closeNewProjectModal() {
    document.getElementById('new-project-modal').classList.remove('visible');
    document.getElementById('project-name-input').value = '';
    document.getElementById('project-description-input').value = '';
}

async function createNewProject() {
    const name = document.getElementById('project-name-input').value.trim();
    const description = document.getElementById('project-description-input').value.trim();
    const template = document.getElementById('project-template-input').value;

    if (!name) {
        showNotification('Please enter a project name', 'error');
        return;
    }

    try {
        const response = await fetch('/api/latex-projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, template })
        });

        const data = await response.json();

        if (data.success) {
            closeNewProjectModal();
            await loadProjects();
            await loadProject(data.projectId);
            showNotification('Project created successfully', 'success');
        } else {
            showNotification(data.error || 'Failed to create project', 'error');
        }
    } catch (error) {
        console.error('Error creating project:', error);
        showNotification('Failed to create project', 'error');
    }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

async function refreshFileTree() {
    if (!currentProjectId) return;

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/files`);
        const data = await response.json();

        if (data.success) {
            fileTree.render(data.files, data.mainFile);

            // Update folder options in new file modal
            updateFolderOptions(data.files);
        }
    } catch (error) {
        console.error('Error loading file tree:', error);
    }
}

function updateFolderOptions(files) {
    const select = document.getElementById('new-file-folder');
    select.innerHTML = '<option value="">Root</option>';

    function addFolders(items, prefix = '') {
        items.forEach(item => {
            if (item.type === 'folder') {
                const path = prefix ? `${prefix}/${item.name}` : item.name;
                const option = document.createElement('option');
                option.value = path;
                option.textContent = path + '/';
                select.appendChild(option);

                if (item.children) {
                    addFolders(item.children, path);
                }
            }
        });
    }

    addFolders(files);
}

async function openFile(filePath) {
    if (!currentProjectId) return;

    const fileType = filePath.split('.').pop().toLowerCase();

    // Check if this is a special file type that needs a viewer
    const needsViewer = fileViewers && fileViewers.needsSpecialViewer(fileType);
    const isImage = fileViewers && fileViewers.isImage(fileType);

    try {
        // For images, we need the raw file URL, not the content
        if (isImage) {
            const rawUrl = `/api/latex-projects/${currentProjectId}/files/${encodeURIComponent(filePath)}/raw`;
            const fileName = filePath.split('/').pop();

            // Open tab with special marker for images
            tabManager.openTab(filePath, '', fileType, { isSpecialViewer: true, viewerType: 'image', rawUrl });
            fileTree.highlightFile(filePath);

            // Show the image viewer
            showFileViewer('image', rawUrl, fileName, fileType);
            return;
        }

        // For text-based files (including markdown)
        const response = await fetch(`/api/latex-projects/${currentProjectId}/files/${filePath}`);
        const data = await response.json();

        if (data.success) {
            const fileName = filePath.split('/').pop();

            if (needsViewer) {
                // Open tab with special viewer marker
                tabManager.openTab(filePath, data.content, fileType, { isSpecialViewer: true, viewerType: fileViewers.getViewerType(fileType) });
                fileTree.highlightFile(filePath);

                // Show appropriate viewer
                showFileViewer(fileViewers.getViewerType(fileType), data.content, fileName, fileType);
            } else {
                // Regular code file - use CodeMirror
                tabManager.openTab(filePath, data.content, fileType, { isSpecialViewer: false });
                fileTree.highlightFile(filePath);
                showCodeEditor();
            }
        } else {
            showNotification('Failed to open file', 'error');
        }
    } catch (error) {
        console.error('Error opening file:', error);
        showNotification('Failed to open file', 'error');
    }
}

// Show the code editor, hide file viewer
function showCodeEditor() {
    const editorWrapper = document.getElementById('code-editor-wrapper');
    const viewerWrapper = document.getElementById('file-viewer-wrapper');

    if (editorWrapper) editorWrapper.style.display = 'block';
    if (viewerWrapper) viewerWrapper.style.display = 'none';
}

// Show a file viewer, hide code editor
function showFileViewer(viewerType, content, fileName, fileType) {
    const editorWrapper = document.getElementById('code-editor-wrapper');
    const viewerWrapper = document.getElementById('file-viewer-wrapper');

    if (!viewerWrapper) return;

    // Hide code editor
    if (editorWrapper) editorWrapper.style.display = 'none';

    // Show and populate viewer
    viewerWrapper.style.display = 'block';
    viewerWrapper.innerHTML = '';

    let viewerElement;

    if (viewerType === 'image') {
        viewerElement = fileViewers.createImageViewer(content, fileName, fileType);
    } else if (viewerType === 'markdown') {
        viewerElement = fileViewers.createMarkdownViewer(content, fileName);
    } else {
        // Fallback - just show content
        viewerElement = document.createElement('div');
        viewerElement.className = 'file-viewer';
        viewerElement.innerHTML = `<pre>${fileViewers.escapeHtml(content)}</pre>`;
    }

    viewerWrapper.appendChild(viewerElement);
}

async function saveCurrentFile(silent = false) {
    const currentTab = tabManager?.getCurrentTab();
    if (!currentTab || !currentProjectId || !editor) return;

    // Update tab content
    tabManager.updateTabContent(currentTab, editor.getValue());

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/files/${currentTab}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: editor.getValue() })
        });

        const data = await response.json();

        if (data.success) {
            isModified = false;
            tabManager.setModified(currentTab, false);
            updateEditorStatus('saved', 'Saved');

            if (!silent) {
                showNotification('File saved', 'success');
            }
        } else {
            showNotification('Failed to save file', 'error');
        }
    } catch (error) {
        console.error('Error saving file:', error);
        showNotification('Failed to save file', 'error');
    }
}

function createNewFile() {
    if (!currentProjectId) {
        showNotification('No project selected', 'error');
        return;
    }
    document.getElementById('new-file-modal').classList.add('visible');
    document.getElementById('new-file-name').focus();
}

function closeNewFileModal() {
    document.getElementById('new-file-modal').classList.remove('visible');
    document.getElementById('new-file-name').value = '';
}

async function createFileFromModal() {
    const fileName = document.getElementById('new-file-name').value.trim();
    const folder = document.getElementById('new-file-folder').value;

    if (!fileName) {
        showNotification('Please enter a file name', 'error');
        return;
    }

    const filePath = folder ? `${folder}/${fileName}` : fileName;
    const fileType = fileName.split('.').pop() || 'tex';

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath, fileType })
        });

        const data = await response.json();

        if (data.success) {
            closeNewFileModal();
            await refreshFileTree();
            await openFile(filePath);
            showNotification('File created', 'success');
        } else {
            showNotification(data.error || 'Failed to create file', 'error');
        }
    } catch (error) {
        console.error('Error creating file:', error);
        showNotification('Failed to create file', 'error');
    }
}

function createNewFolder() {
    const folderName = prompt('Enter folder name:');
    if (!folderName) return;

    // Create a placeholder file in the folder
    const placeholderPath = `${folderName}/.gitkeep`;

    fetch(`/api/latex-projects/${currentProjectId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: placeholderPath, content: '', fileType: 'txt' })
    }).then(() => {
        refreshFileTree();
        showNotification('Folder created', 'success');
    }).catch(error => {
        showNotification('Failed to create folder', 'error');
    });
}

// ============================================================================
// CONTEXT MENU
// ============================================================================

let contextMenuTarget = null;

function showFileContextMenu(event, item) {
    contextMenuTarget = item;

    const menu = document.getElementById('file-context-menu');
    menu.style.display = 'block';
    menu.style.left = `${event.pageX}px`;
    menu.style.top = `${event.pageY}px`;

    // Hide on click outside
    setTimeout(() => {
        document.addEventListener('click', hideContextMenu, { once: true });
    }, 10);
}

function hideContextMenu() {
    document.getElementById('file-context-menu').style.display = 'none';
}

function contextRenameFile() {
    if (!contextMenuTarget) return;

    const newName = prompt('Enter new name:', contextMenuTarget.name);
    if (!newName || newName === contextMenuTarget.name) return;

    const oldPath = contextMenuTarget.path;
    const pathParts = oldPath.split('/');
    pathParts[pathParts.length - 1] = newName;
    const newPath = pathParts.join('/');

    fetch(`/api/latex-projects/${currentProjectId}/files/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath, newPath })
    }).then(response => response.json())
    .then(data => {
        if (data.success) {
            refreshFileTree();
            showNotification('File renamed', 'success');
        } else {
            showNotification(data.error || 'Failed to rename', 'error');
        }
    });
}

function contextDeleteFile() {
    if (!contextMenuTarget) return;

    if (!confirm(`Delete ${contextMenuTarget.name}?`)) return;

    fetch(`/api/latex-projects/${currentProjectId}/files/${contextMenuTarget.path}`, {
        method: 'DELETE'
    }).then(response => response.json())
    .then(data => {
        if (data.success) {
            // Close tab if open
            if (tabManager.getOpenTabs().includes(contextMenuTarget.path)) {
                tabManager.closeTab(contextMenuTarget.path);
            }
            refreshFileTree();
            showNotification('File deleted', 'success');
        } else {
            showNotification(data.error || 'Failed to delete', 'error');
        }
    });
}

function contextSetAsMain() {
    if (!contextMenuTarget || contextMenuTarget.type === 'folder') return;

    fetch(`/api/latex-projects/${currentProjectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ main_file: contextMenuTarget.path })
    }).then(response => response.json())
    .then(data => {
        if (data.success) {
            currentProject.main_file = contextMenuTarget.path;
            refreshFileTree();
            showNotification('Main file updated', 'success');
        }
    });
}

// ============================================================================
// COMPILATION
// ============================================================================

async function compileProject(silent = false) {
    if (!currentProjectId || isCompiling) return;

    isCompiling = true;
    updateEditorStatus('compiling', 'Compiling...');

    // Save current file first
    if (isModified) {
        await saveCurrentFile(true);
    }

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/compile`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            currentPdfPath = data.pdfPath;
            refreshPdfPreview();
            updateEditorStatus('saved', data.hadWarnings ? 'Compiled (warnings)' : 'Compiled');

            if (!silent) {
                showCompileOutput(data.log, data.hadWarnings ? 'warning' : 'success');
            }
        } else {
            updateEditorStatus('error', 'Compile failed');
            showCompileOutput(data.log || data.error, 'error');
        }
    } catch (error) {
        console.error('Error compiling:', error);
        updateEditorStatus('error', 'Compile failed');
        showNotification('Compilation failed', 'error');
    } finally {
        isCompiling = false;
    }
}

function showCompileOutput(log, type = 'info') {
    const output = document.getElementById('compile-output');
    const content = document.getElementById('output-content');

    output.classList.add('visible');
    output.classList.remove('success', 'warning', 'error');
    output.classList.add(type);

    content.textContent = log || 'No output';
}

function hideCompileOutput() {
    document.getElementById('compile-output').classList.remove('visible');
}

async function checkForPdf() {
    if (!currentProjectId) return;

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/pdf`);
        const data = await response.json();

        if (data.success && data.exists) {
            currentPdfPath = data.pdfPath;
            refreshPdfPreview();
        }
    } catch (error) {
        console.error('Error checking for PDF:', error);
    }
}

function refreshPdfPreview() {
    const viewer = document.getElementById('pdf-viewer');
    const placeholder = document.getElementById('pdf-placeholder');

    if (currentPdfPath) {
        viewer.src = currentPdfPath + '?t=' + Date.now();
        viewer.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        viewer.style.display = 'none';
        placeholder.style.display = 'flex';
    }
}

function openPdfInNewTab() {
    if (currentPdfPath) {
        window.open(currentPdfPath, '_blank');
    }
}

// ============================================================================
// DOCUMENT OUTLINE
// ============================================================================

function updateDocumentOutline() {
    if (!editor) return;

    const content = editor.getValue();
    const outlineContent = document.getElementById('outline-content');

    const structure = parseLatexStructure(content);

    if (structure.length === 0) {
        outlineContent.innerHTML = '<div class="outline-empty">No structure found</div>';
        return;
    }

    outlineContent.innerHTML = structure.map(item => `
        <div class="outline-item outline-${item.type}"
             onclick="jumpToLine(${item.line})"
             style="padding-left: ${item.level * 12}px">
            <i class="fas ${getOutlineIcon(item.type)}"></i>
            <span>${escapeHtml(item.title)}</span>
            <span class="outline-line">${item.line}</span>
        </div>
    `).join('');
}

function parseLatexStructure(content) {
    const lines = content.split('\n');
    const structure = [];

    const patterns = [
        { regex: /\\part\{([^}]*)\}/, type: 'part', level: 0 },
        { regex: /\\chapter\{([^}]*)\}/, type: 'chapter', level: 1 },
        { regex: /\\section\{([^}]*)\}/, type: 'section', level: 2 },
        { regex: /\\subsection\{([^}]*)\}/, type: 'subsection', level: 3 },
        { regex: /\\subsubsection\{([^}]*)\}/, type: 'subsubsection', level: 4 },
        { regex: /\\paragraph\{([^}]*)\}/, type: 'paragraph', level: 5 }
    ];

    lines.forEach((line, index) => {
        for (const pattern of patterns) {
            const match = line.match(pattern.regex);
            if (match) {
                structure.push({
                    type: pattern.type,
                    title: match[1],
                    line: index + 1,
                    level: pattern.level
                });
                break;
            }
        }
    });

    return structure;
}

function getOutlineIcon(type) {
    const icons = {
        'part': 'fa-book',
        'chapter': 'fa-bookmark',
        'section': 'fa-heading',
        'subsection': 'fa-h',
        'subsubsection': 'fa-minus',
        'paragraph': 'fa-paragraph'
    };
    return icons[type] || 'fa-circle';
}

function jumpToLine(line) {
    if (!editor) return;
    editor.setCursor({ line: line - 1, ch: 0 });
    editor.scrollIntoView({ line: line - 1, ch: 0 }, 200);
    editor.focus();
}

function toggleOutlinePanel() {
    const panel = document.getElementById('outline-panel');
    panel.classList.toggle('visible');
}

// ============================================================================
// CLAUDE AI INTEGRATION (Full port from tex-editor.js)
// ============================================================================

// Toggle Claude AI sidepanel visibility
function toggleClaudePanel() {
    const panel = document.getElementById('claude-panel');
    if (!panel) return;

    isClaudeAIPanelOpen = !isClaudeAIPanelOpen;
    panel.classList.toggle('visible', isClaudeAIPanelOpen);

    if (isClaudeAIPanelOpen) {
        updateClaudeSelectionInfo();
        loadProjectFilesForAutocomplete();

        // Add paste handler for images and YouTube URLs
        const input = document.getElementById('claude-input');
        if (input && !input._pasteHandlerAdded) {
            input.addEventListener('paste', handleClaudePaste);
            input._pasteHandlerAdded = true;
        }

        // Focus input
        setTimeout(() => input?.focus(), 100);
    }

    // Update button active state
    const claudeBtn = document.querySelector('.claude-btn');
    if (claudeBtn) {
        claudeBtn.classList.toggle('active', isClaudeAIPanelOpen);
    }
}

// Set Claude edit mode (selection or file)
function setClaudeMode(mode) {
    claudeMode = mode;

    const selTab = document.querySelector('.mode-tab[data-mode="selection"]');
    const fileTab = document.querySelector('.mode-tab[data-mode="file"]');

    if (mode === 'selection') {
        if (selTab) selTab.classList.add('active');
        if (fileTab) fileTab.classList.remove('active');
    } else {
        if (fileTab) fileTab.classList.add('active');
        if (selTab) selTab.classList.remove('active');
    }

    updateClaudeSelectionInfo();
}

// Update selection info in Claude panel with visual preview
function updateClaudeSelectionInfo() {
    if (!editor) return;

    const currentSelectionEl = document.getElementById('claude-current-selection');
    const selection = editor.getSelection();

    // Auto-switch mode based on selections
    autoDetectClaudeMode();

    // Update current selection preview
    if (currentSelectionEl) {
        if (selection && selection.length > 0) {
            const lines = selection.split('\n').length;
            const from = editor.getCursor('from');
            const to = editor.getCursor('to');

            // Create preview
            const previewLines = selection.split('\n').slice(0, 2);
            const preview = previewLines.map(line =>
                line.length > 40 ? line.substring(0, 40) + '...' : line
            ).join('\n');
            const hasMore = selection.split('\n').length > 2;

            const alreadyAdded = isSelectionAlreadyAdded(from, to);

            currentSelectionEl.innerHTML = `
                <div class="current-selection-card ${alreadyAdded ? 'already-added' : ''}">
                    <div class="current-selection-header">
                        <span class="current-selection-badge">
                            <i class="fas fa-text-width"></i> ${lines} line${lines > 1 ? 's' : ''} selected
                        </span>
                        <span class="current-selection-range">Lines ${from.line + 1}-${to.line + 1}</span>
                    </div>
                    <div class="current-selection-preview">
                        <pre>${escapeHtml(preview)}${hasMore ? '\n...' : ''}</pre>
                    </div>
                    ${alreadyAdded
                        ? '<div class="current-selection-status"><i class="fas fa-check"></i> Already added</div>'
                        : `<button class="add-selection-btn" onclick="addCurrentSelection()">
                            <i class="fas fa-plus"></i> Add this selection
                        </button>`
                    }
                </div>
            `;
            currentSelectionEl.style.display = 'block';
        } else {
            if (claudeCodeSelections.length === 0 && claudeMode === 'selection') {
                currentSelectionEl.innerHTML = `
                    <div class="no-selection-hint">
                        <i class="fas fa-mouse-pointer"></i>
                        Select text in the editor to add it as a reference
                    </div>
                `;
                currentSelectionEl.style.display = 'block';
            } else {
                currentSelectionEl.style.display = 'none';
            }
        }
    }

    renderCodeSelections();
}

// Auto-detect mode based on selections
function autoDetectClaudeMode() {
    if (claudeCodeSelections.length > 0 && claudeMode !== 'selection') {
        setClaudeModeQuiet('selection');
    } else if (editor) {
        const selection = editor.getSelection();
        if (selection && selection.length > 0 && claudeCodeSelections.length === 0 && claudeMode !== 'selection') {
            if (isClaudeAIPanelOpen) {
                setClaudeModeQuiet('selection');
            }
        }
    }
}

// Set mode without triggering full update
function setClaudeModeQuiet(mode) {
    claudeMode = mode;

    const selTab = document.querySelector('.mode-tab[data-mode="selection"]');
    const fileTab = document.querySelector('.mode-tab[data-mode="file"]');

    if (mode === 'selection') {
        if (selTab) selTab.classList.add('active');
        if (fileTab) fileTab.classList.remove('active');
    } else {
        if (fileTab) fileTab.classList.add('active');
        if (selTab) selTab.classList.remove('active');
    }
}

// Check if current selection is already in the list
function isSelectionAlreadyAdded(from, to) {
    return claudeCodeSelections.some(sel =>
        sel.from.line === from.line &&
        sel.from.ch === from.ch &&
        sel.to.line === to.line &&
        sel.to.ch === to.ch
    );
}

// Add current selection to the list
function addCurrentSelection() {
    if (!editor) return;

    const selection = editor.getSelection();
    if (!selection || selection.length === 0) return;

    const from = editor.getCursor('from');
    const to = editor.getCursor('to');

    if (isSelectionAlreadyAdded(from, to)) {
        showNotification('This selection is already added', 'warning');
        return;
    }

    const selectionObj = {
        id: ++selectionIdCounter,
        text: selection,
        from: { line: from.line, ch: from.ch },
        to: { line: to.line, ch: to.ch },
        lineCount: selection.split('\n').length,
        preview: createSelectionPreview(selection),
        file: tabManager?.getCurrentTab() || 'unknown'
    };

    claudeCodeSelections.push(selectionObj);
    setClaudeModeQuiet('selection');
    updateClaudeSelectionInfo();
    showNotification(`Selection added (Lines ${from.line + 1}-${to.line + 1})`, 'success');
}

// Create a short preview of selection text
function createSelectionPreview(text) {
    const firstLine = text.split('\n')[0];
    return firstLine.length > 30 ? firstLine.substring(0, 30) + '...' : firstLine;
}

// Remove a selection from the list
function removeCodeSelection(id) {
    claudeCodeSelections = claudeCodeSelections.filter(sel => sel.id !== id);

    if (claudeCodeSelections.length === 0) {
        const selection = editor ? editor.getSelection() : '';
        if (!selection || selection.length === 0) {
            setClaudeModeQuiet('file');
        }
    }

    updateClaudeSelectionInfo();
}

// Clear all selections
function clearAllCodeSelections() {
    claudeCodeSelections = [];
    setClaudeModeQuiet('file');
    updateClaudeSelectionInfo();
}

// Render code selections as chips
function renderCodeSelections() {
    const container = document.getElementById('claude-selections');
    if (!container) return;

    if (claudeCodeSelections.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    container.innerHTML = `
        <div class="code-selections-header">
            <span><i class="fas fa-layer-group"></i> Code selections (${claudeCodeSelections.length})</span>
            ${claudeCodeSelections.length > 1 ? `
                <button class="clear-all-selections-btn" onclick="clearAllCodeSelections()" title="Clear all">
                    Clear all
                </button>
            ` : ''}
        </div>
        <div class="code-selections-list">
            ${claudeCodeSelections.map(sel => {
                // Get short file name from path
                const fileName = sel.file ? sel.file.split('/').pop() : 'unknown';
                return `
                <div class="code-selection-chip" data-id="${sel.id}">
                    <div class="code-selection-info">
                        <div class="code-selection-file">
                            <i class="fas fa-file-code"></i> ${escapeHtml(fileName)}
                        </div>
                        <span class="code-selection-lines">
                            Lines ${sel.from.line + 1}-${sel.to.line + 1}
                        </span>
                        <span class="code-selection-preview">${escapeHtml(sel.preview)}</span>
                    </div>
                    <button class="remove-selection-btn" onclick="removeCodeSelection(${sel.id})" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `}).join('')}
        </div>
    `;
}

// ============================================================================
// CLAUDE AI PANEL - INPUT HANDLING
// ============================================================================

// Handle keydown in Claude input
function handleClaudeInputKeydown(event) {
    const autocomplete = document.getElementById('claude-autocomplete');
    const isAutocompleteVisible = autocomplete && autocomplete.classList.contains('visible');

    if (isAutocompleteVisible) {
        const items = autocomplete.querySelectorAll('.autocomplete-item');
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            claudeAutocompleteIndex = Math.min(claudeAutocompleteIndex + 1, items.length - 1);
            updateAutocompleteSelection(items);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            claudeAutocompleteIndex = Math.max(claudeAutocompleteIndex - 1, 0);
            updateAutocompleteSelection(items);
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            if (claudeAutocompleteIndex >= 0 && items[claudeAutocompleteIndex]) {
                selectAutocompleteFile(items[claudeAutocompleteIndex].dataset.file);
            }
        } else if (event.key === 'Escape') {
            hideAutocomplete();
        }
    } else {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            runClaudeAction('custom');
        } else if (event.key === 'Escape') {
            toggleClaudePanel();
        }
    }
}

// Handle input changes (auto-resize and @ detection)
function handleClaudeInputChange(textarea) {
    // Auto-resize textarea
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';

    // Check for @ mention
    const value = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (atMatch) {
        const query = atMatch[1].toLowerCase();
        showFileAutocomplete(query);
    } else {
        hideAutocomplete();
    }
}

// ============================================================================
// CLAUDE AI PANEL - IMAGE SUPPORT
// ============================================================================

// Handle paste event for images and YouTube URLs
function handleClaudePaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    // Check for images
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
                addClaudeImage(file);
            }
            return;
        }
    }

    // Check for YouTube URL
    const pastedText = event.clipboardData.getData('text');
    if (pastedText) {
        const youtubeMatch = pastedText.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/);
        if (youtubeMatch) {
            event.preventDefault();
            const videoId = youtubeMatch[1];
            showYouTubeLanguageModal(videoId);
        }
    }
}

// Handle image file selection
function handleClaudeImageSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        addClaudeImage(file);
    }
    event.target.value = '';
}

// Add image to Claude context
function addClaudeImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        claudePastedImages.push({
            data: e.target.result,
            name: file.name || 'pasted-image.png',
            type: file.type
        });
        renderClaudeImagePreviews();
    };
    reader.readAsDataURL(file);
}

// Render image previews
function renderClaudeImagePreviews() {
    const container = document.getElementById('claude-images');
    if (!container) return;

    if (claudePastedImages.length === 0) {
        container.classList.remove('has-images');
        container.innerHTML = '';
        return;
    }

    container.classList.add('has-images');
    container.innerHTML = claudePastedImages.map((img, i) => `
        <div class="claude-image-item">
            <img src="${img.data}" alt="${img.name}">
            <button class="claude-image-remove" onclick="removeClaudeImage(${i})" title="Remove image">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Remove an image
function removeClaudeImage(index) {
    claudePastedImages.splice(index, 1);
    renderClaudeImagePreviews();
}

// ============================================================================
// CLAUDE AI PANEL - YOUTUBE TRANSCRIPTS
// ============================================================================

// Show YouTube language modal
function showYouTubeLanguageModal(videoId) {
    const existingModal = document.getElementById('youtube-lang-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'youtube-lang-modal';
    modal.className = 'modal-overlay visible';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h3><i class="fab fa-youtube" style="color: #FF0000;"></i> YouTube Video Detected</h3>
                <button class="btn-icon" onclick="document.getElementById('youtube-lang-modal').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <p style="margin-bottom: 16px;">Video ID: <code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px;">${videoId}</code></p>
                <p style="color: var(--text-primary); margin-bottom: 12px;">Select transcript language:</p>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <button onclick="addYouTubeTranscript('${videoId}', 'auto')" class="youtube-lang-btn auto">
                        <i class="fas fa-magic"></i> Auto-detect (Recommended)
                    </button>
                    <button onclick="addYouTubeTranscript('${videoId}', 'en')" class="youtube-lang-btn standard">
                        <span class="flag">🇬🇧</span> English
                    </button>
                    <button onclick="addYouTubeTranscript('${videoId}', 'hi')" class="youtube-lang-btn standard">
                        <span class="flag">🇮🇳</span> Hindi (YouTube captions)
                    </button>
                    <button onclick="addYouTubeTranscript('${videoId}', 'hi-whisper')" class="youtube-lang-btn whisper">
                        <i class="fas fa-robot"></i> Hindi → English (AI Whisper)
                    </button>
                </div>
                <div class="youtube-info-box">
                    <i class="fas fa-info-circle"></i> AI Whisper downloads audio & translates Hindi speech to English. Takes 1-3 min but gives best quality for Hindi videos.
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Add YouTube transcript
async function addYouTubeTranscript(videoId, language) {
    const modal = document.getElementById('youtube-lang-modal');

    if (claudeYoutubeTranscripts.find(t => t.videoId === videoId)) {
        if (modal) modal.remove();
        showNotification('Transcript already added', 'warning');
        return;
    }

    const isWhisper = language === 'hi-whisper';
    if (modal) {
        modal.querySelector('.modal-body').innerHTML = `
            <div class="youtube-loading">
                <i class="fas fa-${isWhisper ? 'robot' : 'spinner'} fa-spin" style="color: ${isWhisper ? '#8B5CF6' : '#F59E0B'};"></i>
                <p style="color: var(--text-primary);">${isWhisper ? 'AI transcribing Hindi → English...' : 'Fetching transcript...'}</p>
                ${isWhisper ? '<p class="loading-hint">Downloading audio & processing (1-3 min)</p>' : ''}
            </div>
        `;
    }

    try {
        const response = await fetch('/api/youtube-transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: videoId, language })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to get transcript');
        }

        claudeYoutubeTranscripts.push({
            videoId: data.videoId,
            language: data.language,
            transcript: data.fullText,
            lineCount: data.lineCount
        });

        renderReferencedFilesDisplay();

        if (modal) modal.remove();
        showNotification(`Transcript added (${data.lineCount} lines)`, 'success');

    } catch (error) {
        console.error('YouTube transcript error:', error);
        if (modal) {
            modal.querySelector('.modal-body').innerHTML = `
                <div class="youtube-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p class="error-title">Failed to fetch transcript</p>
                    <p class="error-message">${error.message}</p>
                    <button onclick="document.getElementById('youtube-lang-modal').remove()" class="youtube-lang-btn standard" style="width: auto; margin: 0 auto;">
                        Close
                    </button>
                </div>
            `;
        }
    }
}

// Remove YouTube transcript
function removeYoutubeRef(videoId) {
    claudeYoutubeTranscripts = claudeYoutubeTranscripts.filter(t => t.videoId !== videoId);
    renderReferencedFilesDisplay();
}

// ============================================================================
// CLAUDE AI PANEL - @ FILE AUTOCOMPLETE
// ============================================================================

// Load project files for autocomplete
async function loadProjectFilesForAutocomplete() {
    if (!currentProjectId) return;

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/files`);
        const data = await response.json();

        if (data.success) {
            const files = flattenFiles(data.files);
            claudeProjectFiles = files
                .filter(f => f.type === 'file')
                .map(f => ({
                    name: f.name,
                    path: f.path,
                    type: f.fileType || 'tex',
                    folder: f.path.split('/').slice(0, -1).join('/') || '/'
                }));
        }
    } catch (error) {
        console.error('Failed to load project files:', error);
    }
}

// Show file autocomplete dropdown
function showFileAutocomplete(query) {
    const autocomplete = document.getElementById('claude-autocomplete');
    if (!autocomplete) return;

    const filtered = claudeProjectFiles.filter(f =>
        f.name.toLowerCase().includes(query) ||
        f.path.toLowerCase().includes(query)
    ).slice(0, 8);

    if (filtered.length === 0) {
        hideAutocomplete();
        return;
    }

    autocomplete.innerHTML = filtered.map((file, index) => `
        <div class="autocomplete-item ${index === 0 ? 'selected' : ''}" data-file="${file.path}" onclick="selectAutocompleteFile('${file.path}')">
            <i class="fas ${file.type === 'pdf' ? 'fa-file-pdf' : 'fa-file-code'}"></i>
            <span class="autocomplete-name">${file.name}</span>
            <span class="autocomplete-path">${file.folder}</span>
        </div>
    `).join('');

    claudeAutocompleteIndex = 0;
    autocomplete.classList.add('visible');
}

// Hide autocomplete
function hideAutocomplete() {
    const autocomplete = document.getElementById('claude-autocomplete');
    if (autocomplete) {
        autocomplete.classList.remove('visible');
    }
    claudeAutocompleteIndex = -1;
}

// Update autocomplete selection highlight
function updateAutocompleteSelection(items) {
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === claudeAutocompleteIndex);
    });
    if (items[claudeAutocompleteIndex]) {
        items[claudeAutocompleteIndex].scrollIntoView({ block: 'nearest' });
    }
}

// Select file from autocomplete
function selectAutocompleteFile(filePath) {
    const textarea = document.getElementById('claude-input');
    if (!textarea) return;

    const value = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const textAfterCursor = value.substring(cursorPos);

    const newTextBefore = textBeforeCursor.replace(/@[^\s@]*$/, '');
    const fileName = filePath.split('/').pop();

    const insertedText = '@' + fileName + ' ';
    const newValue = newTextBefore + insertedText + textAfterCursor.trimStart();
    textarea.value = newValue;

    const newCursorPos = newTextBefore.length + insertedText.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    textarea.focus();

    // Add to referenced files
    if (!claudeReferencedFiles.find(f => f.path === filePath)) {
        const fileInfo = claudeProjectFiles.find(f => f.path === filePath);
        if (fileInfo) {
            claudeReferencedFiles.push(fileInfo);
            renderReferencedFilesDisplay();
        }
    }

    hideAutocomplete();
    handleClaudeInputChange(textarea);
}

// Update the referenced files display
function renderReferencedFilesDisplay() {
    const container = document.getElementById('claude-refs');
    if (!container) return;

    const fileHtml = claudeReferencedFiles.length === 0 ? '' : claudeReferencedFiles.map(file => `
        <span class="referenced-file-tag" data-path="${file.path}">
            <i class="fas ${file.type === 'pdf' ? 'fa-file-pdf' : 'fa-file-code'}"></i>
            ${file.name}
            <button onclick="removeReferencedFile('${file.path}')" class="remove-ref-btn">
                <i class="fas fa-times"></i>
            </button>
        </span>
    `).join('');

    const youtubeHtml = claudeYoutubeTranscripts.map(yt => `
        <span class="referenced-file-tag youtube-ref" data-video-id="${yt.videoId}">
            <i class="fab fa-youtube" style="color: #FF0000;"></i>
            YouTube: ${yt.videoId}
            <button onclick="removeYoutubeRef('${yt.videoId}')" class="remove-ref-btn">
                <i class="fas fa-times"></i>
            </button>
        </span>
    `).join('');

    const hasRefs = claudeReferencedFiles.length > 0 || claudeYoutubeTranscripts.length > 0;

    container.innerHTML = hasRefs ? `
        <div class="referenced-files-header">
            <i class="fas fa-paperclip"></i> References:
        </div>
        <div class="referenced-files-list">
            ${fileHtml}
            ${youtubeHtml}
        </div>
    ` : '';

    container.classList.toggle('has-refs', hasRefs);
}

// Remove a referenced file
function removeReferencedFile(filePath) {
    claudeReferencedFiles = claudeReferencedFiles.filter(f => f.path !== filePath);
    renderReferencedFilesDisplay();
}

// Flatten files helper
function flattenFiles(items, result = []) {
    items.forEach(item => {
        result.push(item);
        if (item.children) {
            flattenFiles(item.children, result);
        }
    });
    return result;
}

// ============================================================================
// CLAUDE AI PANEL - MESSAGES
// ============================================================================

// Add message to AI panel
function addAIMessage(text, type = 'system', images = []) {
    const messagesEl = document.getElementById('claude-messages');
    if (!messagesEl) return;

    const emptyState = messagesEl.querySelector('.claude-empty-state');
    if (emptyState) emptyState.style.display = 'none';

    const msg = document.createElement('div');
    msg.className = `claude-message ${type}`;

    let content = '';
    if (images && images.length > 0) {
        content += `<div class="message-images">
            ${images.map(img => `<img src="${img.data}" alt="${img.name}">`).join('')}
        </div>`;
    }
    content += `<div class="message-text">${escapeHtml(text)}</div>`;

    msg.innerHTML = content;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Clear AI messages
function clearAIMessages() {
    const messagesEl = document.getElementById('claude-messages');
    if (messagesEl) {
        messagesEl.innerHTML = `
            <div class="claude-empty-state">
                <i class="fas fa-magic"></i>
                <p>Select a quick action or type a custom instruction</p>
            </div>
        `;
    }
}

// Update progress indicator
function updateAIProgress(text) {
    const messagesEl = document.getElementById('claude-messages');
    if (!messagesEl) return;

    let progressEl = messagesEl.querySelector('.claude-progress');
    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'claude-progress';
        messagesEl.appendChild(progressEl);
    }

    progressEl.innerHTML = `
        <div class="progress-indicator">
            <i class="fas fa-spinner fa-spin"></i>
            <span>${escapeHtml(text)}</span>
        </div>
    `;
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Clear progress indicator
function clearAIProgress() {
    const progressEl = document.querySelector('.claude-progress');
    if (progressEl) progressEl.remove();
}

// Append live streaming output
function appendLiveToAIPanel(text) {
    const messagesEl = document.getElementById('claude-messages');
    if (!messagesEl) return;

    const emptyState = messagesEl.querySelector('.claude-empty-state');
    if (emptyState) emptyState.style.display = 'none';

    let liveContainer = messagesEl.querySelector('.claude-live-output');
    if (!liveContainer) {
        liveContainer = document.createElement('div');
        liveContainer.className = 'claude-live-output';
        liveContainer.innerHTML = `
            <div class="live-output-header">
                <i class="fas fa-terminal"></i>
                <span>Live Output</span>
                <span class="live-indicator"></span>
            </div>
            <div class="live-output-content"></div>
        `;
        messagesEl.appendChild(liveContainer);
    }

    const contentEl = liveContainer.querySelector('.live-output-content');
    if (contentEl) {
        const line = document.createElement('div');
        line.className = 'live-output-line';
        line.textContent = text;
        contentEl.appendChild(line);

        while (contentEl.children.length > 50) {
            contentEl.removeChild(contentEl.firstChild);
        }

        contentEl.scrollTop = contentEl.scrollHeight;
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Clear live output
function clearLiveOutput() {
    const liveContainer = document.querySelector('.claude-live-output');
    if (liveContainer) liveContainer.remove();
}

// ============================================================================
// CLAUDE AI - MAIN ACTION HANDLER
// ============================================================================

// Run Claude action on selected text or entire file
async function runClaudeAction(action) {
    if (!editor) return;

    // Check state
    if (claudeEditState !== ClaudeEditState.IDLE) {
        showNotification('Claude is already running. Please wait.', 'warning');
        return;
    }

    const currentTab = tabManager?.getCurrentTab();
    if (!currentTab) {
        showNotification('No file open', 'error');
        return;
    }

    // Determine what to edit
    const isFileMode = claudeMode === 'file';
    const currentSelection = editor.getSelection();

    // In selection mode, need selections
    if (!isFileMode) {
        const hasSelections = claudeCodeSelections.length > 0;
        const hasCurrentSelection = currentSelection && currentSelection.length > 0;

        if (!hasSelections && !hasCurrentSelection) {
            showNotification('Please add at least one code selection', 'warning');
            return;
        }

        // Auto-add current selection
        if (hasCurrentSelection && !isSelectionAlreadyAdded(
            editor.getCursor('from'),
            editor.getCursor('to')
        )) {
            addCurrentSelection();
        }
    }

    // Get custom prompt
    let customPrompt = '';
    if (action === 'custom') {
        const customInput = document.getElementById('claude-input');
        customPrompt = customInput ? customInput.value.trim() : '';
        if (!customPrompt) {
            showNotification('Please enter a custom instruction', 'warning');
            return;
        }
    }

    // Clear input
    const inputEl = document.getElementById('claude-input');
    if (inputEl) {
        inputEl.value = '';
        inputEl.style.height = 'auto';
    }

    // Save data before clearing
    const referencedFilePaths = claudeReferencedFiles.map(f => f.path);
    const codeSelectionsToSend = [...claudeCodeSelections];
    const imagesToSend = [...claudePastedImages];
    const youtubeTranscriptsToSend = [...claudeYoutubeTranscripts];

    // Clear UI
    claudeReferencedFiles = [];
    claudeYoutubeTranscripts = [];
    claudeCodeSelections = [];
    claudePastedImages = [];
    renderReferencedFilesDisplay();
    renderCodeSelections();
    renderClaudeImagePreviews();

    // Save backup
    claudeEditBackup.originalContent = editor.getValue();
    claudeEditBackup.filePath = currentTab;

    // Update state
    claudeEditState = ClaudeEditState.RUNNING;
    isClaudeRunning = true;
    claudeCurrentAction = action;
    claudeCurrentCustomPrompt = customPrompt;

    // Show terminal
    showClaudeTerminal();
    clearClaudeTerminal();

    // Log request
    const selectionCountText = codeSelectionsToSend.length > 1
        ? `${codeSelectionsToSend.length} selections`
        : 'selection';
    const userRequest = action === 'custom' ? customPrompt : `${action} the ${isFileMode ? 'entire file' : selectionCountText}`;
    addAIMessage(userRequest, 'user', imagesToSend);

    appendClaudeOutput('═══════════════════════════════════════════', 'header');
    appendClaudeOutput('  CLAUDE EDIT SESSION STARTED', 'header');
    appendClaudeOutput('═══════════════════════════════════════════', 'header');
    appendClaudeOutput(`Action: ${action}`, 'info');
    appendClaudeOutput(`File: ${currentTab}`, 'info');

    if (isFileMode) {
        const fullContent = editor.getValue();
        appendClaudeOutput(`Mode: Entire File (${fullContent.split('\n').length} lines)`, 'info');
    } else {
        const totalLines = codeSelectionsToSend.reduce((sum, sel) => sum + sel.lineCount, 0);
        appendClaudeOutput(`Mode: ${codeSelectionsToSend.length} Selection(s) (${totalLines} total lines)`, 'info');
    }

    if (referencedFilePaths.length > 0) {
        appendClaudeOutput(`Referenced files: ${referencedFilePaths.join(', ')}`, 'info');
    }
    if (youtubeTranscriptsToSend.length > 0) {
        appendClaudeOutput(`YouTube transcripts: ${youtubeTranscriptsToSend.map(t => t.videoId).join(', ')}`, 'info');
    }
    if (imagesToSend.length > 0) {
        appendClaudeOutput(`Attached images: ${imagesToSend.length}`, 'info');
    }

    appendClaudeOutput('', 'info');
    updateClaudeStopButton(true);

    try {
        // Build tex path for project file
        const texPath = `latex-projects/${currentProject.user_id}/${currentProject.name}/${currentTab}`;

        const response = await fetch('/api/claude-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                texPath: texPath,
                codeSelections: isFileMode ? null : codeSelectionsToSend.map(sel => ({
                    text: sel.text,
                    from: sel.from,
                    to: sel.to,
                    lineCount: sel.lineCount
                })),
                action: action,
                customPrompt: customPrompt,
                fullContent: editor.getValue(),
                editMode: claudeMode,
                referencedFiles: referencedFilePaths,
                youtubeTranscripts: youtubeTranscriptsToSend.map(yt => ({
                    videoId: yt.videoId,
                    language: yt.language,
                    transcript: yt.transcript
                })),
                images: imagesToSend.map(img => ({
                    data: img.data,
                    type: img.type,
                    name: img.name
                }))
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Handle SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        handleClaudeSSEMessage(data);
                    } catch (e) {
                        appendClaudeOutput(line.slice(6), 'output');
                    }
                }
            }
        }

    } catch (error) {
        appendClaudeOutput(`Error: ${error.message}`, 'error');
        addAIMessage(`Error: ${error.message}`, 'error');
        resetClaudeState();
    }
}

// Handle SSE message from Claude API
function handleClaudeSSEMessage(data) {
    switch (data.type) {
        case 'backup':
            appendClaudeOutput('Backup created', 'info');
            break;

        case 'claude-start':
            showClaudeSpinner();
            updateAIProgress('Claude is thinking...');
            break;

        case 'claude-done':
            hideClaudeSpinner();
            break;

        case 'change-applied':
            appendClaudeOutput(`  Change ${data.index}/${data.total}: ${data.preview}${data.fuzzy ? ' (fuzzy)' : ''}`, 'success');
            updateAIProgress(`Applying changes: ${data.index}/${data.total}`);
            break;

        case 'change-failed':
            appendClaudeOutput(`  Change ${data.index}/${data.total}: Could not find "${data.preview}"`, 'warning');
            break;

        case 'progress':
            updateClaudeProgress(data.data);
            break;

        case 'output':
            appendClaudeOutput(data.data, 'output');
            break;

        case 'live-output':
            appendClaudeOutput(data.data, 'live');
            appendLiveToAIPanel(data.data);
            break;

        case 'result':
            clearAIProgress();
            clearLiveOutput();

            if (data.newContent && editor) {
                if (data.editMode === 'file') {
                    editor.setValue(data.newContent);
                    if (data.noChanges) {
                        appendClaudeOutput('No changes were made', 'warning');
                        addAIMessage('No changes were applied', 'warning');
                    } else if (data.diffMode) {
                        appendClaudeOutput(`${data.changesApplied} change(s) applied`, 'success');
                        addAIMessage(`Applied ${data.changesApplied} changes`, 'success');
                    } else {
                        appendClaudeOutput('File updated', 'success');
                        addAIMessage('File updated successfully', 'success');
                    }
                } else if (data.isMultiSelection) {
                    editor.setValue(data.newContent);
                    appendClaudeOutput(`${data.selections?.length || 'Multiple'} selections updated`, 'success');
                    clearAllCodeSelections();
                } else {
                    const from = data.selectionRange.from;
                    const to = data.selectionRange.to;
                    editor.replaceRange(data.newContent, from, to);
                    appendClaudeOutput('Selection updated', 'success');
                    clearAllCodeSelections();
                }
                isModified = true;
                updateEditorStatus('modified', 'Modified by Claude');
            }
            break;

        case 'compile-start':
            claudeEditState = ClaudeEditState.COMPILING;
            appendClaudeOutput('', 'info');
            appendClaudeOutput('───────────────────────────────────────────', 'info');
            appendClaudeOutput('  COMPILING LATEX', 'info');
            appendClaudeOutput('───────────────────────────────────────────', 'info');
            break;

        case 'compile-progress':
            appendClaudeOutput(`${data.message}`, 'info');
            break;

        case 'compile-done':
            appendClaudeOutput('PDF compiled successfully', 'success');
            if (data.pdfPath) {
                refreshPdfPreview();
            }
            break;

        case 'compare':
            claudeEditState = ClaudeEditState.REVIEWING;
            appendClaudeOutput('', 'info');
            appendClaudeOutput('═══════════════════════════════════════════', 'header');
            appendClaudeOutput('  REVIEW CHANGES', 'header');
            appendClaudeOutput('═══════════════════════════════════════════', 'header');
            showClaudeReviewPanel();
            break;

        case 'complete':
            hideClaudeSpinner();
            if (claudeEditState !== ClaudeEditState.REVIEWING) {
                appendClaudeOutput('', 'info');
                appendClaudeOutput('Process complete', 'success');
                resetClaudeState();
            }
            updateClaudeStopButton(false);
            isClaudeRunning = false;
            break;

        case 'error':
            hideClaudeSpinner();
            appendClaudeOutput(`Error: ${data.message}`, 'error');
            addAIMessage(`Error: ${data.message}`, 'error');
            resetClaudeState();
            break;
    }
}

// ============================================================================
// CLAUDE AI - TERMINAL FUNCTIONS
// ============================================================================

// Show spinner
function showClaudeSpinner() {
    const content = document.getElementById('claude-terminal-content');
    if (!content) return;

    hideClaudeSpinner();

    const spinner = document.createElement('div');
    spinner.id = 'claude-spinner';
    spinner.className = 'claude-spinner';
    spinner.innerHTML = `
        <div class="spinner-animation">
            <div class="spinner-dot"></div>
            <div class="spinner-dot"></div>
            <div class="spinner-dot"></div>
        </div>
        <span class="spinner-text">Claude is thinking...</span>
    `;
    content.appendChild(spinner);
    content.scrollTop = content.scrollHeight;
}

// Hide spinner
function hideClaudeSpinner() {
    const spinner = document.getElementById('claude-spinner');
    if (spinner) spinner.remove();
}

// Update progress message
function updateClaudeProgress(message) {
    const spinnerText = document.querySelector('#claude-spinner .spinner-text');
    if (spinnerText) {
        spinnerText.textContent = message;
    }
}

// Reset Claude state
function resetClaudeState() {
    claudeEditState = ClaudeEditState.IDLE;
    isClaudeRunning = false;
    updateClaudeStopButton(false);
}

// Show Claude terminal panel
function showClaudeTerminal() {
    const panel = document.getElementById('claude-terminal-panel');
    if (panel) {
        panel.classList.add('visible');
    }
}

// Close Claude terminal panel
function closeClaudeTerminal() {
    const panel = document.getElementById('claude-terminal-panel');
    if (panel) {
        panel.classList.remove('visible');
    }
}

// Clear Claude terminal
function clearClaudeTerminal() {
    const content = document.getElementById('claude-terminal-content');
    if (content) {
        content.innerHTML = '';
    }
}

// Append output to Claude terminal
function appendClaudeOutput(text, type = 'output') {
    const content = document.getElementById('claude-terminal-content');
    if (content) {
        const line = document.createElement('div');
        line.className = `claude-terminal-line ${type}`;
        line.textContent = text;
        content.appendChild(line);
        content.scrollTop = content.scrollHeight;
    }
}

// Update stop button visibility
function updateClaudeStopButton(show) {
    const stopBtn = document.getElementById('claude-stop-btn');
    if (stopBtn) {
        stopBtn.style.display = show ? 'inline-flex' : 'none';
    }
}

// Stop Claude process
async function stopClaudeProcess() {
    if (!isClaudeRunning) return;

    try {
        await fetch('/api/claude-edit/stop', { method: 'POST' });
        appendClaudeOutput('Stopped by user', 'warning');
    } catch (error) {
        appendClaudeOutput(`Error stopping: ${error.message}`, 'error');
    }

    resetClaudeState();
}

// ============================================================================
// CLAUDE AI - REVIEW & ACCEPT/REJECT
// ============================================================================

// State for viewing original
let isViewingOriginal = false;
let currentEditorContent = null;

// Show review panel
function showClaudeReviewPanel() {
    const content = document.getElementById('claude-terminal-content');
    if (!content) return;

    const reviewDiv = document.createElement('div');
    reviewDiv.className = 'claude-review-controls';
    reviewDiv.innerHTML = `
        <div class="claude-review-buttons">
            <button class="claude-review-btn view-original" onclick="toggleViewOriginal()">
                <i class="fas fa-history"></i> View Original
            </button>
            <button class="claude-review-btn diff" onclick="showTextDiff()">
                <i class="fas fa-code-compare"></i> Show Diff
            </button>
        </div>
        <div class="claude-review-actions">
            <button class="claude-review-btn revert" onclick="revertClaudeChanges()">
                <i class="fas fa-undo"></i> Revert
            </button>
            <button class="claude-review-btn keep" onclick="keepClaudeChanges()">
                <i class="fas fa-check"></i> Keep Changes
            </button>
        </div>
    `;
    content.appendChild(reviewDiv);

    appendClaudeOutput('Review your changes. PDF preview shows the new version.', 'info');
}

// Toggle viewing original code
function toggleViewOriginal() {
    if (!editor || !claudeEditBackup.originalContent) return;

    const btn = document.querySelector('.claude-review-btn.view-original');

    if (!isViewingOriginal) {
        currentEditorContent = editor.getValue();
        editor.setValue(claudeEditBackup.originalContent);
        editor.setOption('readOnly', true);
        isViewingOriginal = true;

        if (btn) {
            btn.innerHTML = '<i class="fas fa-times"></i> Close Original';
            btn.classList.add('active');
        }

        appendClaudeOutput('Viewing original code (read-only)', 'info');
    } else {
        editor.setValue(currentEditorContent);
        editor.setOption('readOnly', false);
        isViewingOriginal = false;
        currentEditorContent = null;

        if (btn) {
            btn.innerHTML = '<i class="fas fa-history"></i> View Original';
            btn.classList.remove('active');
        }

        appendClaudeOutput('Back to current version', 'info');
    }
}

// Show text diff modal
function showTextDiff() {
    if (!claudeEditBackup.originalContent || !editor) return;

    const oldContent = claudeEditBackup.originalContent;
    const newContent = isViewingOriginal ? currentEditorContent : editor.getValue();

    let modal = document.getElementById('claude-diff-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'claude-diff-modal';
    modal.className = 'claude-diff-modal-overlay';

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let diffHtml = '';
    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];

        if (oldLine === newLine) {
            diffHtml += `<div class="diff-line same"><span class="line-num">${i + 1}</span><span class="line-content">${escapeHtml(oldLine || '')}</span></div>`;
        } else {
            if (oldLine !== undefined && newLine !== undefined) {
                diffHtml += `<div class="diff-line removed"><span class="line-num">-${i + 1}</span><span class="line-content">${escapeHtml(oldLine)}</span></div>`;
                diffHtml += `<div class="diff-line added"><span class="line-num">+${i + 1}</span><span class="line-content">${escapeHtml(newLine)}</span></div>`;
            } else if (oldLine === undefined) {
                diffHtml += `<div class="diff-line added"><span class="line-num">+${i + 1}</span><span class="line-content">${escapeHtml(newLine)}</span></div>`;
            } else {
                diffHtml += `<div class="diff-line removed"><span class="line-num">-${i + 1}</span><span class="line-content">${escapeHtml(oldLine)}</span></div>`;
            }
        }
    }

    modal.innerHTML = `
        <div class="claude-diff-modal">
            <div class="claude-diff-header">
                <h3><i class="fas fa-code-compare"></i> Text Diff</h3>
                <button class="claude-diff-close" onclick="closeTextDiff()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="claude-diff-content">${diffHtml}</div>
            <div class="claude-diff-footer">
                <span class="diff-legend">
                    <span class="legend-removed">- Removed</span>
                    <span class="legend-added">+ Added</span>
                </span>
                <button class="claude-diff-btn" onclick="closeTextDiff()">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.classList.add('visible');
}

// Close text diff modal
function closeTextDiff() {
    const modal = document.getElementById('claude-diff-modal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
    }
}

// Keep Claude changes
async function keepClaudeChanges() {
    appendClaudeOutput('', 'info');
    appendClaudeOutput('Changes kept!', 'success');

    // Save the file
    await saveCurrentFile();

    // Recompile
    await compileProject();

    // Clear backup
    claudeEditBackup = {
        originalContent: null,
        originalPdfPath: null,
        filePath: null
    };

    resetClaudeState();
    showNotification('Changes saved successfully!', 'success');
}

// Revert Claude changes
async function revertClaudeChanges() {
    if (!claudeEditBackup.originalContent) {
        showNotification('No backup available to revert to', 'warning');
        return;
    }

    appendClaudeOutput('', 'info');
    appendClaudeOutput('Reverting changes...', 'warning');

    // Restore editor content
    if (editor) {
        editor.setValue(claudeEditBackup.originalContent);
        isModified = true;
        updateEditorStatus('modified', 'Reverted');
    }

    appendClaudeOutput('Editor content restored', 'success');
    appendClaudeOutput('Saving and recompiling...', 'info');

    // Save and recompile
    await saveCurrentFile();
    await compileProject();

    // Clear backup
    claudeEditBackup = {
        originalContent: null,
        originalPdfPath: null,
        filePath: null
    };

    resetClaudeState();
    appendClaudeOutput('Reverted to original!', 'success');
    showNotification('Reverted to original version', 'success');
}

// ============================================================================
// YOUTUBE REFERENCES
// ============================================================================

async function loadYoutubeRefs() {
    if (!currentProjectId) return;

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/youtube`);
        const data = await response.json();

        const list = document.getElementById('youtube-refs-list');

        if (data.success && data.references.length > 0) {
            list.innerHTML = data.references.map(ref => `
                <div class="youtube-ref-item" onclick="openYoutubeVideo('${ref.video_id}', ${ref.timestamp_seconds})">
                    <img src="https://img.youtube.com/vi/${ref.video_id}/default.jpg" alt="Thumbnail">
                    <div class="ref-info">
                        <div class="ref-title">${escapeHtml(ref.video_title || 'Video')}</div>
                        <div class="ref-note">${escapeHtml(ref.note || '')}</div>
                    </div>
                    <button class="btn-remove" onclick="event.stopPropagation(); deleteYoutubeRef(${ref.id})">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('');
        } else {
            list.innerHTML = '<div class="empty-refs">No video references</div>';
        }
    } catch (error) {
        console.error('Error loading YouTube refs:', error);
    }
}

function toggleYoutubeSection() {
    const section = document.getElementById('youtube-refs-section');
    section.classList.toggle('collapsed');
}

function openAddYoutubeModal() {
    document.getElementById('youtube-modal').classList.add('visible');
    document.getElementById('youtube-url').focus();
}

function closeYoutubeModal() {
    document.getElementById('youtube-modal').classList.remove('visible');
    document.getElementById('youtube-url').value = '';
    document.getElementById('youtube-note').value = '';
}

async function addYoutubeReference() {
    const url = document.getElementById('youtube-url').value.trim();
    const note = document.getElementById('youtube-note').value.trim();

    if (!url) {
        showNotification('Please enter a YouTube URL', 'error');
        return;
    }

    // Extract video ID
    const videoId = extractYoutubeId(url);
    if (!videoId) {
        showNotification('Invalid YouTube URL', 'error');
        return;
    }

    // Extract timestamp if present
    const timestamp = extractYoutubeTimestamp(url);

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/youtube`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                videoId,
                videoTitle: '',
                timestampSeconds: timestamp,
                note,
                filePath: tabManager?.getCurrentTab() || ''
            })
        });

        const data = await response.json();

        if (data.success) {
            closeYoutubeModal();
            loadYoutubeRefs();
            showNotification('Video reference added', 'success');
        } else {
            showNotification(data.error || 'Failed to add reference', 'error');
        }
    } catch (error) {
        showNotification('Failed to add reference', 'error');
    }
}

function extractYoutubeId(url) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
        /^([a-zA-Z0-9_-]{11})$/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
}

function extractYoutubeTimestamp(url) {
    const match = url.match(/[?&]t=(\d+)/);
    return match ? parseInt(match[1]) : 0;
}

function openYoutubeVideo(videoId, timestamp = 0) {
    const url = `https://www.youtube.com/watch?v=${videoId}${timestamp ? '&t=' + timestamp : ''}`;
    window.open(url, '_blank');
}

async function deleteYoutubeRef(refId) {
    if (!confirm('Remove this video reference?')) return;

    try {
        await fetch(`/api/latex-projects/${currentProjectId}/youtube/${refId}`, {
            method: 'DELETE'
        });
        loadYoutubeRefs();
        showNotification('Reference removed', 'success');
    } catch (error) {
        showNotification('Failed to remove reference', 'error');
    }
}

// ============================================================================
// VERSION CONTROL
// ============================================================================

function toggleVersionPanel() {
    const panel = document.getElementById('version-panel');
    panel.classList.toggle('visible');

    if (panel.classList.contains('visible')) {
        loadGitStatus();
        loadGitHistory();
    }
}

// ============================================================================
// GIT VERSION CONTROL
// ============================================================================

let selectedRollbackHash = null;

// Load Git status
async function loadGitStatus() {
    if (!currentProjectId) return;

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/status`);
        const data = await response.json();

        const notInitEl = document.getElementById('git-not-initialized');
        const initEl = document.getElementById('git-initialized');

        if (data.success && data.initialized) {
            notInitEl.style.display = 'none';
            initEl.style.display = 'flex';

            document.getElementById('git-branch-name').textContent = data.branch || 'main';

            const badge = document.getElementById('git-status-badge');
            if (data.hasChanges) {
                badge.textContent = 'Uncommitted changes';
                badge.className = 'git-status-badge has-changes';
            } else if (data.ahead > 0) {
                badge.textContent = `${data.ahead} ahead`;
                badge.className = 'git-status-badge ahead';
            } else {
                badge.textContent = 'Clean';
                badge.className = 'git-status-badge clean';
            }

            // Show GitHub link if repo URL exists
            const repoLinkEl = document.getElementById('git-repo-link');
            if (repoLinkEl && data.repoUrl) {
                const repoHtmlUrl = data.repoUrl.replace(/\.git$/, '').replace('git@github.com:', 'https://github.com/');
                repoLinkEl.href = repoHtmlUrl;
                repoLinkEl.style.display = 'inline-flex';
            } else if (repoLinkEl) {
                repoLinkEl.style.display = 'none';
            }
        } else {
            notInitEl.style.display = 'block';
            initEl.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading git status:', error);
    }
}

// Load Git commit history
async function loadGitHistory() {
    if (!currentProjectId) return;

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/log?limit=30`);
        const data = await response.json();

        const list = document.getElementById('git-commit-list');

        if (data.success && data.commits && data.commits.length > 0) {
            list.innerHTML = data.commits.map((commit, index) => `
                <div class="git-commit-item ${index === 0 ? 'first' : ''} ${commit.isAutoSave ? 'auto-save' : ''}" data-hash="${commit.hash}">
                    <div class="git-commit-icon">
                        <i class="fas ${commit.isAutoSave ? 'fa-clock' : 'fa-code-commit'}"></i>
                    </div>
                    <div class="git-commit-info">
                        <div class="git-commit-message" title="${escapeHtml(commit.message)}">${escapeHtml(commit.message)}</div>
                        <div class="git-commit-meta">
                            <span class="git-commit-hash">${commit.shortHash}</span>
                            <span>${formatGitDate(commit.date)}</span>
                        </div>
                    </div>
                    <div class="git-commit-actions">
                        <button class="btn-commit-action rollback" onclick="openRollbackModal('${commit.hash}', '${escapeHtml(commit.message).replace(/'/g, "\\'")}', '${commit.date}')" title="Rollback to this commit">
                            <i class="fas fa-undo"></i>
                        </button>
                    </div>
                </div>
            `).join('');
        } else if (!data.initialized) {
            list.innerHTML = `
                <div class="git-empty-state">
                    <i class="fab fa-git-alt"></i>
                    <p>Initialize Git to start tracking versions</p>
                </div>
            `;
        } else {
            list.innerHTML = `
                <div class="git-empty-state">
                    <i class="fas fa-code-commit"></i>
                    <p>No commits yet</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading git history:', error);
    }
}

// Initialize Git for project (auto-creates GitHub repo)
async function initGit() {
    if (!currentProjectId) return;

    try {
        showNotification('Initializing Git and creating GitHub repo...', 'info');

        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/init`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            if (data.repoUrl) {
                showNotification(`Created GitHub repo: ${data.repoName}`, 'success');
            } else {
                showNotification('Git initialized locally', 'success');
            }
            loadGitStatus();
            loadGitHistory();
        } else {
            showNotification(data.error || 'Failed to initialize Git', 'error');
        }
    } catch (error) {
        showNotification('Failed to initialize Git', 'error');
    }
}

// Open commit modal
async function gitCommit() {
    if (!currentProjectId) return;

    // First check if there are changes to commit
    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/status`);
        const data = await response.json();

        if (!data.hasChanges) {
            showNotification('No changes to commit', 'info');
            return;
        }

        // Show changes in modal
        const changesPreview = document.getElementById('git-changes-preview');
        changesPreview.innerHTML = data.changes.map(change => {
            const status = change.charAt(0);
            const file = change.substring(2).trim();
            let className = 'modified';
            let icon = 'fa-edit';
            if (status === 'A' || status === '?') {
                className = 'added';
                icon = 'fa-plus';
            } else if (status === 'D') {
                className = 'deleted';
                icon = 'fa-minus';
            }
            return `<div class="git-change-item ${className}"><i class="fas ${icon}"></i> ${escapeHtml(file)}</div>`;
        }).join('');

        document.getElementById('git-commit-message').value = '';
        document.getElementById('git-commit-modal').classList.add('visible');
    } catch (error) {
        showNotification('Failed to check git status', 'error');
    }
}

function closeCommitModal() {
    document.getElementById('git-commit-modal').classList.remove('visible');
}

// Submit the commit
async function submitCommit() {
    const message = document.getElementById('git-commit-message').value.trim();
    if (!message) {
        showNotification('Please enter a commit message', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (data.success) {
            closeCommitModal();
            showNotification('Changes committed!', 'success');
            loadGitStatus();
            loadGitHistory();
        } else {
            showNotification(data.error || 'Commit failed', 'error');
        }
    } catch (error) {
        showNotification('Commit failed', 'error');
    }
}

// Open remote modal
function openRemoteModal() {
    document.getElementById('git-remote-modal').classList.add('visible');
}

function closeRemoteModal() {
    document.getElementById('git-remote-modal').classList.remove('visible');
}

// Set Git remote URL
async function setGitRemote() {
    const url = document.getElementById('git-remote-url').value.trim();
    if (!url) {
        showNotification('Please enter a remote URL', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/remote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await response.json();

        if (data.success) {
            closeRemoteModal();
            showNotification('Remote URL set!', 'success');
            loadGitStatus();
        } else {
            showNotification(data.error || 'Failed to set remote', 'error');
        }
    } catch (error) {
        showNotification('Failed to set remote', 'error');
    }
}

// Push to remote (auto-creates GitHub repo if needed)
async function gitPush() {
    if (!currentProjectId) return;

    try {
        showNotification('Pushing to GitHub...', 'info');

        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/push`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            if (data.repoName) {
                showNotification(`Created and pushed to GitHub: ${data.repoName}`, 'success');
            } else {
                showNotification('Pushed to GitHub successfully!', 'success');
            }
            loadGitStatus();
        } else if (data.needsForce) {
            if (confirm('Push was rejected. Force push? (This will overwrite remote changes)')) {
                const forceResponse = await fetch(`/api/latex-projects/${currentProjectId}/git/push`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ force: true })
                });
                const forceData = await forceResponse.json();
                if (forceData.success) {
                    showNotification('Force pushed successfully!', 'success');
                    loadGitStatus();
                } else {
                    showNotification(forceData.error || 'Force push failed', 'error');
                }
            }
        } else {
            showNotification(data.error || 'Push failed', 'error');
        }
    } catch (error) {
        showNotification('Push failed', 'error');
    }
}

// Open rollback modal
function openRollbackModal(hash, message, date) {
    selectedRollbackHash = hash;

    const info = document.getElementById('rollback-commit-info');
    info.innerHTML = `
        <div class="commit-hash">${hash.substring(0, 7)}</div>
        <div class="commit-message">${message}</div>
        <div class="commit-date">${formatGitDate(date)}</div>
    `;

    document.getElementById('git-rollback-modal').classList.add('visible');
}

function closeRollbackModal() {
    document.getElementById('git-rollback-modal').classList.remove('visible');
    selectedRollbackHash = null;
}

// Confirm rollback
async function confirmRollback() {
    if (!selectedRollbackHash || !currentProjectId) return;

    try {
        showNotification('Rolling back...', 'info');

        const response = await fetch(`/api/latex-projects/${currentProjectId}/git/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash: selectedRollbackHash })
        });

        const data = await response.json();

        if (data.success) {
            closeRollbackModal();
            showNotification(`Rolled back to ${selectedRollbackHash.substring(0, 7)}. Backup: ${data.backupBranch}`, 'success');

            // Reload the current file
            const currentTab = tabManager?.getCurrentTab();
            if (currentTab) {
                await openFile(currentTab);
            }

            // Refresh file tree and git status
            await refreshFileTree();
            loadGitStatus();
            loadGitHistory();

            // Recompile to get new PDF
            await compileProject();
        } else {
            showNotification(data.error || 'Rollback failed', 'error');
        }
    } catch (error) {
        showNotification('Rollback failed', 'error');
    }
}

// Format git date
function formatGitDate(isoDate) {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
}

// ============================================================================
// UTILITIES
// ============================================================================

function updateEditorStatus(status, text) {
    const statusEl = document.getElementById('editor-status');
    if (!statusEl) return;

    statusEl.className = 'editor-status ' + status;

    const icons = {
        'ready': 'fa-circle',
        'modified': 'fa-circle',
        'saved': 'fa-check-circle',
        'compiling': 'fa-spinner fa-spin',
        'error': 'fa-exclamation-circle'
    };

    statusEl.innerHTML = `<i class="fas ${icons[status] || 'fa-circle'}"></i><span>${text}</span>`;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check' : type === 'error' ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i>
        <span>${message}</span>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('visible'), 10);

    // Remove after delay
    setTimeout(() => {
        notification.classList.remove('visible');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Make functions globally available
window.switchProject = switchProject;
window.openNewProjectModal = openNewProjectModal;
window.closeNewProjectModal = closeNewProjectModal;
window.createNewProject = createNewProject;
window.saveCurrentFile = saveCurrentFile;
window.compileProject = compileProject;
window.toggleClaudePanel = toggleClaudePanel;
window.createNewFile = createNewFile;
window.closeNewFileModal = closeNewFileModal;
window.createFileFromModal = createFileFromModal;
window.createNewFolder = createNewFolder;
window.refreshFileTree = refreshFileTree;
window.toggleOutlinePanel = toggleOutlinePanel;
window.jumpToLine = jumpToLine;
window.hideCompileOutput = hideCompileOutput;
window.refreshPdfPreview = refreshPdfPreview;
window.openPdfInNewTab = openPdfInNewTab;

// Claude AI functions
window.setClaudeMode = setClaudeMode;
window.addCurrentSelection = addCurrentSelection;
window.removeCodeSelection = removeCodeSelection;
window.clearAllCodeSelections = clearAllCodeSelections;
window.runClaudeAction = runClaudeAction;
window.handleClaudeInputKeydown = handleClaudeInputKeydown;
window.handleClaudeInputChange = handleClaudeInputChange;
window.handleClaudeImageSelect = handleClaudeImageSelect;
window.removeClaudeImage = removeClaudeImage;
window.addYouTubeTranscript = addYouTubeTranscript;
window.removeYoutubeRef = removeYoutubeRef;
window.selectAutocompleteFile = selectAutocompleteFile;
window.removeReferencedFile = removeReferencedFile;
window.closeClaudeTerminal = closeClaudeTerminal;
window.stopClaudeProcess = stopClaudeProcess;
window.toggleViewOriginal = toggleViewOriginal;
window.showTextDiff = showTextDiff;
window.closeTextDiff = closeTextDiff;
window.keepClaudeChanges = keepClaudeChanges;
window.revertClaudeChanges = revertClaudeChanges;

// YouTube references
window.toggleYoutubeSection = toggleYoutubeSection;
window.openAddYoutubeModal = openAddYoutubeModal;
window.closeYoutubeModal = closeYoutubeModal;
window.addYoutubeReference = addYoutubeReference;
window.openYoutubeVideo = openYoutubeVideo;
window.deleteYoutubeRef = deleteYoutubeRef;

// Git Version Control
window.toggleVersionPanel = toggleVersionPanel;
window.loadGitStatus = loadGitStatus;
window.loadGitHistory = loadGitHistory;
window.initGit = initGit;
window.gitCommit = gitCommit;
window.closeCommitModal = closeCommitModal;
window.submitCommit = submitCommit;
window.openRemoteModal = openRemoteModal;
window.closeRemoteModal = closeRemoteModal;
window.setGitRemote = setGitRemote;
window.gitPush = gitPush;
window.openRollbackModal = openRollbackModal;
window.closeRollbackModal = closeRollbackModal;
window.confirmRollback = confirmRollback;

// Context menu
window.contextRenameFile = contextRenameFile;
window.contextDeleteFile = contextDeleteFile;
window.contextSetAsMain = contextSetAsMain;

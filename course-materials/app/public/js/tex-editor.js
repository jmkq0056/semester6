// ============================================================================
// LATEX EDITOR MODULE
// ============================================================================

let texEditor = null;
let currentTexFile = { name: '', path: '', category: '' };
let isTexModified = false;
let associatedPdfPath = null;
let autoCompileTimeout = null;
let isTexEditorOpen = false;
let outlineUpdateTimeout = null;
let isOutlineVisible = true;

// Claude integration state
let claudeProcess = null;
let isClaudeRunning = false;
let backupTexPath = null;

// Claude edit state machine
const ClaudeEditState = {
    IDLE: 'idle',
    RUNNING: 'running',
    REVIEWING: 'reviewing',
    COMPILING: 'compiling'
};
let claudeEditState = ClaudeEditState.IDLE;

// In-memory backup for instant revert
let claudeEditBackup = {
    originalContent: null,
    originalPdfPath: null,
    backupTexPath: null,
    backupPdfPath: null,
    newPdfPath: null
};

// Claude edit mode: 'selection' or 'file'
let claudeEditMode = 'file';

// Track current Claude action for version saving
let claudeCurrentAction = null;
let claudeCurrentCustomPrompt = '';

// Claude @ file references
let claudeReferencedFiles = [];
let claudeSubjectFiles = [];
let claudeAutocompleteIndex = -1;

// Claude chat side panel state
let isClaudeChatPanelOpen = false;

// Claude AI sidepanel state (new unified panel)
let isClaudeAIPanelOpen = false;
let claudePastedImages = []; // Store pasted images as base64
let claudeCodeSelections = []; // Store multiple code selections as references
let selectionIdCounter = 0; // Unique ID for each selection
let claudeYoutubeTranscripts = []; // Store YouTube transcripts for reference

// Version control state
let isVersionPanelOpen = false;
let texVersions = [];
let currentVersionNumber = null;
let lastSavedContent = null;
let versionSaveTimeout = null;
const VERSION_SAVE_DELAY = 10000; // 10 seconds of inactivity before auto-saving version

// Auto-compile debounce delay in ms
const AUTO_COMPILE_DELAY = 1500;
// Outline update debounce delay
const OUTLINE_UPDATE_DELAY = 500;

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

// Open TeX file in editor (split view by default: editor left, PDF right)
async function openTexEditor(title, path, category = '', updateUrl = true) {
    const modal = document.getElementById('pdf-modal');
    const paneLeft = document.getElementById('pane-left');
    const paneRight = document.getElementById('pane-right');
    const divider = document.getElementById('divider');

    // Store current tex file info
    currentTexFile = { name: title, path, category };
    isTexEditorOpen = true;

    // Safety: if updateUrl is true (user action), ensure isRestoringState is false
    if (updateUrl && typeof isRestoringState !== 'undefined') {
        isRestoringState = false;
    }

    // Update URL to reflect tex editor state
    if (updateUrl && typeof updateTexEditorURL === 'function') {
        updateTexEditorURL(path, true);
    }

    // Update modal title
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-subtitle').textContent = category + ' (LaTeX)';

    // Show modal
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';

    // Add tex-editor-mode class to hide PDF-specific controls via CSS
    modal.classList.add('tex-editor-mode');

    // Remove any existing editor container
    const existingEditor = paneLeft.querySelector('.tex-editor-container');
    if (existingEditor) {
        existingEditor.remove();
    }

    // Hide PDF viewer in left pane
    const pdfViewer = document.getElementById('pdf-viewer-left');
    pdfViewer.style.display = 'none';

    // Hide left pane header (we'll use editor toolbar instead)
    const paneLeftHeader = document.getElementById('pane-left-header');
    if (paneLeftHeader) paneLeftHeader.style.display = 'none';

    // Create editor container
    const editorContainer = document.createElement('div');
    editorContainer.className = 'tex-editor-container';
    editorContainer.innerHTML = `
        <div class="tex-editor-toolbar">
            <div class="toolbar-left">
                <button class="tex-back-btn" onclick="navigateBack()" title="Back to files">
                    <i class="fas fa-arrow-left"></i> Back
                </button>
                <button class="tex-editor-btn outline-toggle" onclick="toggleOutline()" title="Toggle Outline (Cmd/Ctrl+O)">
                    <i class="fas fa-list-ul"></i>
                </button>
                <button class="tex-editor-btn search" onclick="openTexSearch()" title="Search (Cmd/Ctrl+F)">
                    <i class="fas fa-search"></i>
                </button>
                <button class="tex-editor-btn goto" onclick="openTexGotoLine()" title="Go to Line (Cmd/Ctrl+G)">
                    <i class="fas fa-hashtag"></i>
                </button>
                <span class="tex-editor-status" id="tex-status">
                    <i class="fas fa-file-code"></i> Ready
                </span>
            </div>
            <div class="toolbar-right">
                <button class="tex-editor-btn study" onclick="openStudyWithClaude()" title="Study with Claude (Cmd/Ctrl+Shift+S)">
                    <i class="fas fa-graduation-cap"></i> Study
                </button>
                <button class="tex-editor-btn claude" onclick="toggleClaudeAIPanel()" title="Edit with Claude (Cmd/Ctrl+E)" id="claude-edit-btn">
                    <i class="fas fa-magic"></i> Edit
                </button>
                <button class="tex-editor-btn versions" onclick="toggleVersionPanel()" title="Version History (Cmd/Ctrl+Shift+V)" id="version-toggle-btn">
                    <i class="fas fa-code-branch"></i> <span class="version-badge" id="version-badge">v1</span>
                </button>
                <button class="tex-editor-btn save" onclick="saveTexFile()" title="Save (Cmd/Ctrl+S)">
                    <i class="fas fa-save"></i> Save
                </button>
                <button class="tex-editor-btn compile" onclick="compileTexFile()" title="Compile to PDF (Cmd/Ctrl+B)">
                    <i class="fas fa-file-pdf"></i> Compile PDF
                </button>
            </div>
        </div>
        <div class="tex-editor-main">
            <div class="tex-outline-panel" id="tex-outline-panel">
                <div class="tex-outline-header">
                    <span><i class="fas fa-sitemap"></i> Document Outline</span>
                    <button class="tex-outline-close" onclick="toggleOutline()" title="Close">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="tex-outline-content" id="tex-outline-content">
                    <div class="tex-outline-loading">Parsing document...</div>
                </div>
            </div>
            <div class="tex-editor-area">
                <textarea id="tex-editor-textarea"></textarea>
            </div>
        </div>
        <div class="tex-compile-output" id="tex-compile-output"></div>
        <div class="claude-terminal-panel" id="claude-terminal-panel">
            <div class="claude-terminal-header">
                <span><i class="fas fa-terminal"></i> Claude Output</span>
                <div class="claude-terminal-controls">
                    <button class="claude-terminal-btn stop" onclick="stopClaudeProcess()" id="claude-stop-btn" style="display:none">
                        <i class="fas fa-stop"></i> Stop
                    </button>
                    <button class="claude-terminal-btn close" onclick="closeClaudeTerminal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            <div class="claude-terminal-content" id="claude-terminal-content"></div>
        </div>
    `;

    // Add Version Control Side Panel
    if (!document.getElementById('version-control-panel')) {
        const versionPanel = document.createElement('div');
        versionPanel.id = 'version-control-panel';
        versionPanel.className = 'version-control-panel';
        versionPanel.innerHTML = `
            <div class="version-panel-header">
                <div class="version-panel-title">
                    <i class="fas fa-code-branch"></i>
                    <span>Version History</span>
                </div>
                <button class="version-panel-close" onclick="toggleVersionPanel()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="version-panel-current" id="version-panel-current">
                <div class="current-version-label">Current Version</div>
                <div class="current-version-info" id="current-version-info">
                    <span class="version-number">v1</span>
                    <span class="version-source user">User</span>
                </div>
            </div>
            <div class="version-panel-actions">
                <button class="version-action-btn" onclick="saveVersionManually()">
                    <i class="fas fa-plus"></i> Save New Version
                </button>
            </div>
            <div class="version-panel-list" id="version-panel-list">
                <div class="version-loading">
                    <i class="fas fa-spinner fa-spin"></i> Loading versions...
                </div>
            </div>
        `;
        document.body.appendChild(versionPanel);
    }

    // Add Claude AI Side Panel (unified panel with input, actions, and chat)
    if (!document.getElementById('claude-ai-panel')) {
        const aiPanel = document.createElement('div');
        aiPanel.id = 'claude-ai-panel';
        aiPanel.className = 'claude-ai-panel';
        aiPanel.innerHTML = `
            <div class="claude-ai-header">
                <div class="claude-ai-title">
                    <i class="fas fa-magic"></i>
                    <span>Edit with Claude</span>
                </div>
                <button class="claude-ai-close" onclick="toggleClaudeAIPanel()">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Mode Selection -->
            <div class="claude-ai-mode-section">
                <div class="claude-ai-mode-tabs">
                    <button class="claude-ai-mode-tab" id="claude-ai-tab-selection" onclick="setClaudeMode('selection')">
                        <i class="fas fa-text-width"></i> Selection
                        <span class="selection-count-badge" id="selection-count-badge" style="display:none">0</span>
                    </button>
                    <button class="claude-ai-mode-tab active" id="claude-ai-tab-file" onclick="setClaudeMode('file')">
                        <i class="fas fa-file-alt"></i> Entire File
                    </button>
                </div>
                <!-- Code Selections Area (like file references) -->
                <div class="claude-ai-selections" id="claude-ai-selections"></div>
                <!-- Current selection preview / add button -->
                <div class="claude-ai-current-selection" id="claude-ai-current-selection"></div>
            </div>

            <!-- Quick Actions -->
            <div class="claude-ai-actions">
                <div class="claude-ai-actions-label">Quick Actions</div>
                <div class="claude-ai-actions-grid">
                    <button class="claude-ai-action-btn" onclick="runClaudeAction('improve')">
                       <i class="fas fa-wand-magic-sparkles"></i> Improve clarity
                    </button>
                    <button class="claude-ai-action-btn" onclick="runClaudeAction('fix')">
                        <i class="fas fa-wrench"></i> Fix errors
                    </button>
                    <button class="claude-ai-action-btn" onclick="runClaudeAction('simplify')">
                        <i class="fas fa-compress-alt"></i> Simplify
                    </button>
                    <button class="claude-ai-action-btn" onclick="runClaudeAction('expand')">
                        <i class="fas fa-expand-alt"></i> Expand/elaborate
                    </button>
                    <button class="claude-ai-action-btn" onclick="runClaudeAction('symbols')">
                        <i class="fas fa-square-root-alt"></i> Add proper symbols
                    </button>
                </div>
            </div>

            <!-- Chat Messages Area -->
            <div class="claude-ai-messages" id="claude-ai-messages">
                <div class="claude-ai-empty-state" id="claude-ai-empty-state">
                    <i class="fas fa-magic"></i>
                    <p>Select a quick action above or type a custom instruction below</p>
                </div>
            </div>

            <!-- Referenced Files Bar -->
            <div class="claude-ai-refs" id="claude-ai-refs"></div>

            <!-- Image Preview Area -->
            <div class="claude-ai-images" id="claude-ai-images"></div>

            <!-- Input Area -->
            <div class="claude-ai-input-area">
                <div class="claude-ai-input-wrapper">
                    <textarea id="claude-ai-input" placeholder="Custom instruction... (@ files, paste images or YouTube URLs)" rows="3" oninput="handleClaudeAIInputChange(this)" onkeydown="handleClaudeAIKeydown(event)"></textarea>
                    <div id="claude-ai-autocomplete" class="claude-ai-autocomplete"></div>
                </div>
                <div class="claude-ai-input-actions">
                    <label class="claude-ai-image-btn" title="Attach image">
                        <i class="fas fa-image"></i>
                        <input type="file" accept="image/*" style="display:none" onchange="handleClaudeImageSelect(event)">
                    </label>
                    <button class="claude-ai-send-btn" onclick="runClaudeAction('custom')" id="claude-ai-send-btn">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(aiPanel);

        // Handle paste for images in the panel
        aiPanel.addEventListener('paste', handleClaudePaste);
    }

    paneLeft.insertBefore(editorContainer, paneLeft.firstChild);

    // Load file content
    try {
        const response = await fetch(`/api/tex-content/${path}`);
        const data = await response.json();

        if (data.success) {
            // Initialize CodeMirror with search support
            texEditor = CodeMirror.fromTextArea(
                document.getElementById('tex-editor-textarea'),
                {
                    mode: 'stex',
                    theme: 'material-darker',
                    lineNumbers: true,
                    matchBrackets: true,
                    autoCloseBrackets: true,
                    indentUnit: 4,
                    tabSize: 4,
                    indentWithTabs: false,
                    lineWrapping: true,
                    foldGutter: true,
                    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
                    extraKeys: {
                        'Cmd-S': function() { saveTexFile(); return false; },
                        'Ctrl-S': function() { saveTexFile(); return false; },
                        'Cmd-B': function() { compileTexFile(); return false; },
                        'Ctrl-B': function() { compileTexFile(); return false; },
                        'Cmd-F': 'findPersistent',
                        'Ctrl-F': 'findPersistent',
                        'Cmd-G': function() { openTexGotoLine(); return false; },
                        'Ctrl-G': function() { openTexGotoLine(); return false; },
                        'Cmd-H': 'replace',
                        'Ctrl-H': 'replace',
                        'Cmd-O': function() { toggleOutline(); return false; },
                        'Ctrl-O': function() { toggleOutline(); return false; },
                        'Cmd-E': function() { toggleClaudeAIPanel(); return false; },
                        'Ctrl-E': function() { toggleClaudeAIPanel(); return false; },
                        'F3': 'findNext',
                        'Shift-F3': 'findPrev'
                    }
                }
            );

            texEditor.setValue(data.content);
            isTexModified = false;

            // Parse outline on initial load
            updateDocumentOutline();

            // Track modifications and auto-compile
            texEditor.on('change', () => {
                if (!isTexModified) {
                    isTexModified = true;
                    updateTexStatus('modified', 'Modified');
                }

                // Auto-compile on save (debounced) - skip if Claude is running
                clearTimeout(autoCompileTimeout);
                autoCompileTimeout = setTimeout(async () => {
                    if (isTexModified && isTexEditorOpen && !isClaudeRunning) {
                        await saveTexFile();
                        await compileTexFile();
                    }
                }, AUTO_COMPILE_DELAY);

                // Update outline (debounced)
                clearTimeout(outlineUpdateTimeout);
                outlineUpdateTimeout = setTimeout(() => {
                    updateDocumentOutline();
                }, OUTLINE_UPDATE_DELAY);

                // Schedule auto-version save (debounced)
                if (!isClaudeRunning) {
                    scheduleVersionSave();
                }
            });

            // Track selection changes for Claude button
            texEditor.on('cursorActivity', () => {
                updateClaudeSelectionInfo();
            });

            // Try to find associated PDF and show in split view
            await setupSplitViewWithPdf(path);

            // Initialize version control
            await initializeVersionControl();

        } else {
            showNotification('Failed to load file: ' + data.error, 5000);
        }
    } catch (error) {
        showNotification('Error loading file: ' + error.message, 5000);
    }
}

// ============================================================================
// SPLIT VIEW SETUP
// ============================================================================

// Set up split view with PDF on the right
async function setupSplitViewWithPdf(texPath) {
    const pdfPath = texPath.replace(/\.tex$/i, '.pdf');
    const paneRight = document.getElementById('pane-right');
    const paneRightHeader = document.getElementById('pane-right-header');
    const paneRightTitle = document.getElementById('pane-right-title');
    const viewerRight = document.getElementById('pdf-viewer-right');
    const divider = document.getElementById('divider');

    // Check if associated PDF exists - use direct API check to avoid race conditions
    let pdfExists = false;
    try {
        const checkResponse = await fetch(`/api/file-exists/${encodeURIComponent(pdfPath)}`);
        const checkData = await checkResponse.json();
        pdfExists = checkData.exists === true;
    } catch (e) {
        // Fallback to checking allFiles if API fails
        pdfExists = allFiles.some(f => f.path === pdfPath && !f.isTexFile);
    }

    // In tex editor mode, we don't show the header - just the PDF directly
    if (paneRightHeader) paneRightHeader.style.display = 'none';

    if (pdfExists) {
        // PDF exists - show it in split view
        associatedPdfPath = pdfPath;

        paneRight.style.display = 'flex';
        // Add cache bust to ensure fresh PDF is loaded
        viewerRight.src = pdfPath + '?t=' + Date.now();
        divider.style.display = 'block';

        isSplitView = true;

        // Hide split resize controls (not needed for tex editing)
        const resizeControls = document.getElementById('split-resize-controls');
        if (resizeControls) resizeControls.style.display = 'none';

        // Apply saved split ratio
        if (typeof loadSplitRatio === 'function') {
            loadSplitRatio();
        }
    } else {
        // No PDF yet - show placeholder
        associatedPdfPath = pdfPath; // Still set for compile

        paneRight.style.display = 'flex';
        divider.style.display = 'block';

        viewerRight.srcdoc = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        color: #666;
                        text-align: center;
                        background: #f5f5f7;
                    }
                    .placeholder {
                        padding: 40px;
                    }
                    .placeholder i {
                        font-size: 48px;
                        color: #ccc;
                        margin-bottom: 16px;
                        display: block;
                    }
                    .placeholder p {
                        margin: 8px 0;
                    }
                    .placeholder .hint {
                        font-size: 12px;
                        color: #999;
                    }
                </style>
                <link rel="stylesheet" href="/libs/fontawesome/all.min.css">
            </head>
            <body>
                <div class="placeholder">
                    <i class="fas fa-file-pdf"></i>
                    <p>No compiled PDF yet</p>
                    <p class="hint">Click "Compile" to generate PDF</p>
                </div>
            </body>
            </html>
        `;

        isSplitView = true;
    }
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

// Update status indicator
function updateTexStatus(status, text) {
    const statusEl = document.getElementById('tex-status');
    if (!statusEl) return;

    statusEl.className = 'tex-editor-status ' + status;

    const icons = {
        'modified': 'circle',
        'saved': 'check-circle',
        'compiling': 'spinner fa-spin',
        'error': 'exclamation-circle',
        'ready': 'file-code'
    };

    statusEl.innerHTML = `<i class="fas fa-${icons[status] || 'file-code'}"></i> ${text}`;
}

// Save TeX file
async function saveTexFile() {
    if (!texEditor) return;

    updateTexStatus('compiling', 'Saving...');

    try {
        const response = await fetch(`/api/tex-content/${currentTexFile.path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: texEditor.getValue() })
        });

        const data = await response.json();

        if (data.success) {
            isTexModified = false;
            updateTexStatus('saved', 'Saved');
            // Don't show notification for auto-save to reduce noise
        } else {
            updateTexStatus('error', 'Save failed');
            showNotification('Save failed: ' + data.error, 5000);
        }
    } catch (error) {
        updateTexStatus('error', 'Save failed');
        showNotification('Save error: ' + error.message, 5000);
    }
}

// Compilation lock to prevent concurrent compilations
let isCompiling = false;

// Compile TeX file
async function compileTexFile() {
    if (!texEditor) return;

    // Prevent concurrent compilations
    if (isCompiling || isClaudeRunning) {
        console.log('Skipping compile - already compiling or Claude is running');
        return;
    }

    isCompiling = true;

    // Save first if modified
    if (isTexModified) {
        await saveTexFile();
    }

    updateTexStatus('compiling', 'Compiling...');
    const outputEl = document.getElementById('tex-compile-output');
    if (outputEl) {
        outputEl.className = 'tex-compile-output visible';
        outputEl.textContent = 'Compiling LaTeX...';
    }

    try {
        const response = await fetch('/api/compile-tex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texPath: currentTexFile.path })
        });

        const data = await response.json();

        if (data.success) {
            // Check if there were warnings (compiled but with errors)
            if (data.hadWarnings) {
                updateTexStatus('saved', 'Compiled (with warnings)');
                if (outputEl) {
                    outputEl.className = 'tex-compile-output visible warning';
                    outputEl.textContent = 'Compilation completed with warnings:\n' + (data.log || data.message);
                    // Don't auto-hide warnings - let user dismiss
                }
            } else {
                updateTexStatus('saved', 'Compiled');
                if (outputEl) {
                    outputEl.className = 'tex-compile-output visible success';
                    outputEl.textContent = 'Compilation successful!';

                    // Hide output after 3 seconds
                    setTimeout(() => {
                        outputEl.className = 'tex-compile-output';
                    }, 3000);
                }
            }

            // Refresh file list to show new PDF
            if (typeof loadPDFStructure === 'function') {
                await loadPDFStructure();
            }

            // Refresh the PDF in right pane
            refreshPdfPreview(data.pdfPath);

        } else {
            updateTexStatus('error', 'Compile failed');
            if (outputEl) {
                outputEl.className = 'tex-compile-output visible error';
                outputEl.textContent = 'Compilation failed:\n' + (data.log || data.error);
            }
        }
    } catch (error) {
        updateTexStatus('error', 'Compile failed');
        if (outputEl) {
            outputEl.className = 'tex-compile-output visible error';
            outputEl.textContent = 'Error: ' + error.message;
        }
    } finally {
        isCompiling = false;
    }
}

// Compile and replace existing PDF
async function compileAndReplacePdf() {
    if (!texEditor) return;

    // Save first
    if (isTexModified) {
        await saveTexFile();
    }

    updateTexStatus('compiling', 'Compiling...');
    const outputEl = document.getElementById('tex-compile-output');
    if (outputEl) {
        outputEl.className = 'tex-compile-output visible';
        outputEl.textContent = 'Compiling and replacing PDF...';
    }

    try {
        const response = await fetch('/api/compile-tex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                texPath: currentTexFile.path,
                outputPath: associatedPdfPath
            })
        });

        const data = await response.json();

        if (data.success) {
            // Check if there were warnings
            if (data.hadWarnings) {
                updateTexStatus('saved', 'Replaced (with warnings)');
                if (outputEl) {
                    outputEl.className = 'tex-compile-output visible warning';
                    outputEl.textContent = 'PDF replaced with warnings:\n' + (data.log || data.message);
                }
            } else {
                updateTexStatus('saved', 'Replaced');
                if (outputEl) {
                    outputEl.className = 'tex-compile-output visible success';
                    outputEl.textContent = 'PDF replaced successfully!';

                    setTimeout(() => {
                        outputEl.className = 'tex-compile-output';
                    }, 3000);
                }
            }
            showNotification('PDF replaced: ' + associatedPdfPath);

            // Refresh the PDF viewer
            refreshPdfPreview(associatedPdfPath);

        } else {
            updateTexStatus('error', 'Replace failed');
            if (outputEl) {
                outputEl.className = 'tex-compile-output visible error';
                outputEl.textContent = 'Failed:\n' + (data.log || data.error);
            }
        }
    } catch (error) {
        updateTexStatus('error', 'Replace failed');
        if (outputEl) {
            outputEl.className = 'tex-compile-output visible error';
            outputEl.textContent = 'Error: ' + error.message;
        }
    }
}

// Refresh PDF preview in right pane (with retry limit)
async function refreshPdfPreview(pdfPath, retryCount = 0) {
    const MAX_RETRIES = 5;
    const viewerRight = document.getElementById('pdf-viewer-right');

    if (viewerRight && isSplitView) {
        // First verify the PDF exists (avoid showing error page)
        try {
            const checkResponse = await fetch(`/api/file-exists/${encodeURIComponent(pdfPath)}`);
            const checkData = await checkResponse.json();

            if (!checkData.exists && retryCount < MAX_RETRIES) {
                console.log(`PDF not found yet, retry ${retryCount + 1}/${MAX_RETRIES}...`);
                // PDF doesn't exist yet - wait and retry
                setTimeout(() => refreshPdfPreview(pdfPath, retryCount + 1), 500);
                return;
            }
        } catch (e) {
            console.log('Failed to check PDF existence, proceeding anyway');
        }

        // IMPORTANT: Clear srcdoc first - it takes precedence over src!
        // This is needed when transitioning from placeholder to actual PDF
        viewerRight.removeAttribute('srcdoc');

        // Force reload by clearing and re-setting src
        viewerRight.src = '';
        setTimeout(() => {
            viewerRight.src = pdfPath + '?t=' + Date.now(); // Cache bust
        }, 150);

        // Update title
        const paneRightTitle = document.getElementById('pane-right-title');
        if (paneRightTitle) {
            const pdfName = pdfPath.split('/').pop().replace('.pdf', '');
            paneRightTitle.textContent = pdfName + ' (Preview)';
        }
    }
}

// ============================================================================
// CLEANUP
// ============================================================================

// Close TeX editor and restore PDF viewer
function closeTexEditor() {
    const modal = document.getElementById('pdf-modal');
    const paneLeft = document.getElementById('pane-left');
    const editorContainer = paneLeft.querySelector('.tex-editor-container');

    // Clear auto-compile timeout
    clearTimeout(autoCompileTimeout);

    if (editorContainer) {
        // Warn if unsaved changes
        if (isTexModified) {
            if (!confirm('You have unsaved changes. Close anyway?')) {
                return false;
            }
        }

        editorContainer.remove();
        texEditor = null;
    }

    // Remove tex-editor-mode class to restore PDF controls
    if (modal) modal.classList.remove('tex-editor-mode');

    // Restore PDF viewer
    const pdfViewer = document.getElementById('pdf-viewer-left');
    if (pdfViewer) pdfViewer.style.display = 'block';

    // Restore left pane header
    const paneLeftHeader = document.getElementById('pane-left-header');
    if (paneLeftHeader) paneLeftHeader.style.display = '';

    currentTexFile = { name: '', path: '', category: '' };
    isTexModified = false;
    associatedPdfPath = null;
    isTexEditorOpen = false;

    return true;
}

// Hook into the existing closePDF function to also close tex editor
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        // Wrap the existing closePDF if it exists and hasn't been wrapped yet
        if (typeof closePDF === 'function' && !closePDF._texEditorWrapped) {
            const original = closePDF;
            window.closePDF = function() {
                // Close tex editor first
                if (isTexEditorOpen) {
                    if (!closeTexEditor()) {
                        return; // User cancelled
                    }
                }
                // Call original
                if (typeof original === 'function') {
                    original.apply(this, arguments);
                }
            };
            window.closePDF._texEditorWrapped = true;
        }
    });
}

// ============================================================================
// LATEX AVAILABILITY CHECK
// ============================================================================

// Check if LaTeX is available on system startup
async function checkLatexAvailability() {
    try {
        const response = await fetch('/api/check-latex');
        const data = await response.json();

        if (!data.available) {
            console.warn('pdflatex is not available. LaTeX compilation will not work.');
            // Could show a warning notification here if desired
        }
    } catch (error) {
        console.error('Could not check LaTeX availability:', error);
    }
}

// Check on page load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', checkLatexAvailability);
}

// ============================================================================
// DOCUMENT OUTLINE / NAVIGATION
// ============================================================================

// Parse LaTeX document structure and update outline panel
function updateDocumentOutline() {
    if (!texEditor) return;

    const content = texEditor.getValue();
    const outlineContent = document.getElementById('tex-outline-content');
    if (!outlineContent) return;

    // Parse structure elements
    const structure = parseLatexStructure(content);

    if (structure.length === 0) {
        outlineContent.innerHTML = `
            <div class="tex-outline-empty">
                <i class="fas fa-info-circle"></i>
                <span>No document structure found</span>
            </div>
        `;
        return;
    }

    // Build outline HTML
    let html = '<ul class="tex-outline-list">';
    structure.forEach((item, index) => {
        const indentClass = `indent-${item.level}`;
        const icon = getOutlineIcon(item.type);
        html += `
            <li class="tex-outline-item ${indentClass}"
                onclick="jumpToLine(${item.line})"
                title="Line ${item.line + 1}">
                <span class="outline-icon">${icon}</span>
                <span class="outline-text">${escapeHtml(item.title)}</span>
                <span class="outline-line">${item.line + 1}</span>
            </li>
        `;
    });
    html += '</ul>';

    outlineContent.innerHTML = html;
}

// Parse LaTeX document for structure (sections, subsections, etc.)
function parseLatexStructure(content) {
    const structure = [];
    const lines = content.split('\n');

    // Regex patterns for different structure elements
    const patterns = [
        { regex: /\\part\{([^}]*)\}/,           type: 'part',           level: 0 },
        { regex: /\\chapter\{([^}]*)\}/,        type: 'chapter',        level: 1 },
        { regex: /\\section\{([^}]*)\}/,        type: 'section',        level: 2 },
        { regex: /\\subsection\{([^}]*)\}/,     type: 'subsection',     level: 3 },
        { regex: /\\subsubsection\{([^}]*)\}/,  type: 'subsubsection',  level: 4 },
        { regex: /\\paragraph\{([^}]*)\}/,      type: 'paragraph',      level: 5 },
        // Also catch begin/end environments for important blocks
        { regex: /\\begin\{(document)\}/,       type: 'document',       level: 0 },
        { regex: /\\begin\{(abstract)\}/,       type: 'abstract',       level: 2 },
        { regex: /\\begin\{(thebibliography)\}/,type: 'bibliography',   level: 2 },
        { regex: /\\begin\{(appendix)\}/,       type: 'appendix',       level: 2 },
        // Custom boxes (common in cheatsheets)
        { regex: /\\begin\{(definitionbox)\}\[([^\]]*)\]/, type: 'definition', level: 3, titleGroup: 2 },
        { regex: /\\begin\{(examplebox)\}\[([^\]]*)\]/,    type: 'example',    level: 3, titleGroup: 2 },
        { regex: /\\begin\{(notebox)\}\[([^\]]*)\]/,       type: 'note',       level: 3, titleGroup: 2 },
        { regex: /\\begin\{(warningbox)\}\[([^\]]*)\]/,    type: 'warning',    level: 3, titleGroup: 2 },
        // Tables and figures
        { regex: /\\begin\{(table)\}/,          type: 'table',          level: 4 },
        { regex: /\\begin\{(figure)\}/,         type: 'figure',         level: 4 },
    ];

    lines.forEach((line, lineNum) => {
        // Skip commented lines
        if (line.trim().startsWith('%')) return;

        for (const pattern of patterns) {
            const match = line.match(pattern.regex);
            if (match) {
                const title = pattern.titleGroup
                    ? match[pattern.titleGroup] || match[1]
                    : match[1];
                structure.push({
                    type: pattern.type,
                    title: title,
                    level: pattern.level,
                    line: lineNum
                });
                break; // Only match first pattern per line
            }
        }
    });

    return structure;
}

// Get icon for outline item type
function getOutlineIcon(type) {
    const icons = {
        'part':           '<i class="fas fa-book"></i>',
        'chapter':        '<i class="fas fa-bookmark"></i>',
        'section':        '<i class="fas fa-heading"></i>',
        'subsection':     '<i class="fas fa-angle-right"></i>',
        'subsubsection':  '<i class="fas fa-angle-double-right"></i>',
        'paragraph':      '<i class="fas fa-paragraph"></i>',
        'document':       '<i class="fas fa-file-alt"></i>',
        'abstract':       '<i class="fas fa-quote-left"></i>',
        'bibliography':   '<i class="fas fa-book-reader"></i>',
        'appendix':       '<i class="fas fa-paperclip"></i>',
        'definition':     '<i class="fas fa-lightbulb"></i>',
        'example':        '<i class="fas fa-code"></i>',
        'note':           '<i class="fas fa-sticky-note"></i>',
        'warning':        '<i class="fas fa-exclamation-triangle"></i>',
        'table':          '<i class="fas fa-table"></i>',
        'figure':         '<i class="fas fa-image"></i>',
    };
    return icons[type] || '<i class="fas fa-circle"></i>';
}

// Jump to a specific line in the editor
function jumpToLine(lineNum) {
    if (!texEditor) return;

    // Set cursor to start of line
    texEditor.setCursor({ line: lineNum, ch: 0 });

    // Scroll to center the line in view
    const coords = texEditor.charCoords({ line: lineNum, ch: 0 }, 'local');
    const scrollInfo = texEditor.getScrollInfo();
    const middleY = coords.top - scrollInfo.clientHeight / 2;
    texEditor.scrollTo(null, Math.max(0, middleY));

    // Flash/highlight the line briefly
    const lineHandle = texEditor.addLineClass(lineNum, 'background', 'tex-highlight-line');
    setTimeout(() => {
        texEditor.removeLineClass(lineHandle, 'background', 'tex-highlight-line');
    }, 1500);

    // Focus the editor
    texEditor.focus();
}

// Navigate back to the index/file browser (using browser history)
function navigateBack() {
    // Check if there's history to go back to
    if (window.history.length > 1) {
        // Close the tex editor first (without URL update since we're navigating)
        if (typeof closeTexEditor === 'function') {
            isTexModified = false; // Skip unsaved changes prompt since we're navigating back
            closeTexEditor();
        }
        window.history.back();
    } else {
        // No history, redirect to home
        window.location.href = '/';
    }
}

// Toggle outline panel visibility
function toggleOutline() {
    const outlinePanel = document.getElementById('tex-outline-panel');
    if (!outlinePanel) return;

    isOutlineVisible = !isOutlineVisible;
    outlinePanel.style.display = isOutlineVisible ? 'flex' : 'none';

    // Update button active state
    const toggleBtn = document.querySelector('.tex-editor-btn.outline-toggle');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active', isOutlineVisible);
    }

    // Refresh editor size
    if (texEditor) {
        setTimeout(() => texEditor.refresh(), 100);
    }
}

// Open search dialog
function openTexSearch() {
    if (texEditor) {
        texEditor.execCommand('findPersistent');
    }
}

// Open go to line dialog
function openTexGotoLine() {
    if (!texEditor) return;

    // Use CodeMirror's jump-to-line if available
    if (texEditor.execCommand) {
        texEditor.execCommand('jumpToLine');
    }
}

// Escape HTML for safe display
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// CREATE NEW TEX FILE - MODAL BASED
// ============================================================================

let newTexSubjectCode = null;

// Open the new tex file modal
async function createNewTexFile() {
    // Get current subject from API
    try {
        const response = await fetch('/api/current-subject');
        const data = await response.json();
        if (data.success && data.subject && data.subject.code) {
            newTexSubjectCode = data.subject.code;
        } else {
            showNotification('Please select a subject first', 3000);
            return;
        }
    } catch (error) {
        console.error('Error fetching current subject:', error);
        showNotification('Please select a subject first', 3000);
        return;
    }

    // Fetch folders for this subject
    try {
        const response = await fetch(`/api/subject-folders/${newTexSubjectCode}`);
        const data = await response.json();

        if (data.success && data.folders) {
            populateNewTexCategories(data.folders);
        }
    } catch (error) {
        console.error('Error fetching folders:', error);
    }

    // Show modal
    const modal = document.getElementById('new-tex-modal');
    if (modal) {
        modal.classList.add('visible');
        // Focus filename input
        setTimeout(() => {
            const input = document.getElementById('new-tex-filename');
            if (input) input.focus();
        }, 100);
    }
}

// Populate category dropdown with actual folders
function populateNewTexCategories(folders) {
    const select = document.getElementById('new-tex-category');
    if (!select) return;

    select.innerHTML = '';

    // Add "Create New Category" option first
    const createNewOption = document.createElement('option');
    createNewOption.value = '__create_new__';
    createNewOption.textContent = '+ Create New Category...';
    createNewOption.style.fontWeight = 'bold';
    createNewOption.style.color = '#007AFF';
    select.appendChild(createNewOption);

    // Add separator
    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = '──────────────';
    select.appendChild(separator);

    // Add each folder as an option
    folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder;
        // Format display name: notes -> Notes, exercises-no-solutions -> Exercises No Solutions
        option.textContent = folder
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        select.appendChild(option);
    });

    // Default to 'notes' if available
    if (folders.includes('notes')) {
        select.value = 'notes';
    } else if (folders.length > 0) {
        select.value = folders[0];
    }

    // Listen for "Create New" selection
    select.removeEventListener('change', handleNewTexCategoryChange);
    select.addEventListener('change', handleNewTexCategoryChange);
}

// Handle category dropdown change - show new category input if needed
function handleNewTexCategoryChange(e) {
    const select = e.target;
    const newCategoryInput = document.getElementById('new-tex-new-category-input');

    if (select.value === '__create_new__') {
        // Show new category input
        if (!newCategoryInput) {
            const inputDiv = document.createElement('div');
            inputDiv.className = 'new-tex-form-group';
            inputDiv.id = 'new-tex-new-category-input';
            inputDiv.innerHTML = `
                <label for="new-tex-new-category-name">New Category Name</label>
                <input type="text" id="new-tex-new-category-name" placeholder="e.g., my-notes, practice-problems" autocomplete="off">
                <div class="hint">This will create a new folder in the subject directory</div>
            `;
            select.parentElement.after(inputDiv);

            // Focus the new input
            setTimeout(() => {
                document.getElementById('new-tex-new-category-name')?.focus();
            }, 50);
        }
    } else {
        // Hide new category input if shown
        if (newCategoryInput) {
            newCategoryInput.remove();
        }
    }
}

// Close the modal
function closeNewTexModal() {
    const modal = document.getElementById('new-tex-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
    // Clear form
    const input = document.getElementById('new-tex-filename');
    if (input) input.value = '';

    // Clear lecture number input
    const lectureInput = document.getElementById('new-tex-lecture-number');
    if (lectureInput) lectureInput.value = '';

    // Remove any new category input that was added
    const newCategoryInput = document.getElementById('new-tex-new-category-input');
    if (newCategoryInput) {
        newCategoryInput.remove();
    }

    newTexSubjectCode = null;
}

// Submit the new tex file
async function submitNewTexFile() {
    const filenameInput = document.getElementById('new-tex-filename');
    const categorySelect = document.getElementById('new-tex-category');
    const lectureNumberInput = document.getElementById('new-tex-lecture-number');

    if (!filenameInput || !categorySelect) return;

    const filename = filenameInput.value.trim();
    let category = categorySelect.value;
    const lectureNumber = lectureNumberInput ? lectureNumberInput.value.trim() : '';

    if (!filename) {
        showNotification('Please enter a filename', 3000);
        filenameInput.focus();
        return;
    }

    if (!newTexSubjectCode) {
        showNotification('No subject selected', 3000);
        return;
    }

    // Handle new category creation
    if (category === '__create_new__') {
        const newCategoryInput = document.getElementById('new-tex-new-category-name');
        const newCategoryName = newCategoryInput?.value.trim();

        if (!newCategoryName) {
            showNotification('Please enter a category name', 3000);
            newCategoryInput?.focus();
            return;
        }

        // Clean category name to folder-friendly format
        category = newCategoryName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/--+/g, '-')
            .replace(/^-|-$/g, '');

        if (!category) {
            showNotification('Invalid category name', 3000);
            return;
        }
    }

    // Clean filename
    let cleanFilename = filename
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '-')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '');

    if (!cleanFilename) {
        showNotification('Invalid filename', 3000);
        return;
    }

    // Handle lecture number: prefix filename with lec-{number}-
    if (lectureNumber) {
        const lecNum = parseInt(lectureNumber);
        if (!isNaN(lecNum) && lecNum > 0) {
            // Remove any existing lecture prefix from the filename
            cleanFilename = cleanFilename
                .replace(/^lec[- _]?\d*[- _]?/i, '')
                .replace(/^lecture[- _]?\d*[- _]?/i, '')
                .replace(/^\d+[- _]+/, '')
                .replace(/^-+|-+$/g, '');

            // Prefix with lec-{number}-
            cleanFilename = `lec-${lecNum}-${cleanFilename}`;
        }
    }

    // Determine directory
    const directory = `subjects/${newTexSubjectCode}/${category}`;

    try {
        const response = await fetch('/api/create-tex', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                directory: directory,
                filename: cleanFilename
            })
        });

        const data = await response.json();

        if (data.success) {
            closeNewTexModal();
            showNotification(`Created: ${data.filename}`, 3000);

            // Refresh file list and wait for it to complete
            if (typeof loadPDFStructure === 'function') {
                await loadPDFStructure();
            }

            // Format category name for display
            const categoryDisplay = category
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            // Open the new file in editor
            const title = cleanFilename.replace(/[-_]/g, ' ');
            openTexEditor(title, data.path, categoryDisplay);
        } else {
            showNotification('Failed to create file: ' + data.error, 5000);
        }
    } catch (error) {
        showNotification('Error creating file: ' + error.message, 5000);
    }
}

// Handle Enter key in filename input
document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('new-tex-filename');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitNewTexFile();
            } else if (e.key === 'Escape') {
                closeNewTexModal();
            }
        });
    }
});

// ============================================================================
// CLAUDE INTEGRATION - ROBUST VERSION
// ============================================================================

// Toggle Claude AI sidepanel visibility
function toggleClaudeAIPanel() {
    const panel = document.getElementById('claude-ai-panel');
    if (!panel) return;

    isClaudeAIPanelOpen = !isClaudeAIPanelOpen;
    panel.classList.toggle('open', isClaudeAIPanelOpen);

    if (isClaudeAIPanelOpen) {
        updateClaudeSelectionInfo();
        loadSubjectFilesForAutocomplete();
        const customInput = document.getElementById('claude-ai-input');
        if (customInput) {
            setTimeout(() => customInput.focus(), 100);
        }
    }

    // Update Edit button active state
    const editBtn = document.getElementById('claude-edit-btn');
    if (editBtn) {
        editBtn.classList.toggle('active', isClaudeAIPanelOpen);
    }
}

// Legacy function for backwards compatibility
function toggleClaudeDropdown() {
    toggleClaudeAIPanel();
}

// Set Claude edit mode (selection or file)
function setClaudeMode(mode) {
    claudeEditMode = mode;

    // Update tab active states (support both old and new element IDs)
    const selTab = document.getElementById('claude-ai-tab-selection') || document.getElementById('claude-tab-selection');
    const fileTab = document.getElementById('claude-ai-tab-file') || document.getElementById('claude-tab-file');

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
    if (!texEditor) return;

    const currentSelectionEl = document.getElementById('claude-ai-current-selection');
    const selection = texEditor.getSelection();

    // Auto-switch mode based on selections
    autoDetectClaudeMode();

    // Update current selection preview (always show what's currently selected)
    if (currentSelectionEl) {
        if (selection && selection.length > 0) {
            const lines = selection.split('\n').length;
            const from = texEditor.getCursor('from');
            const to = texEditor.getCursor('to');

            // Create preview of selected text (truncated)
            const previewLines = selection.split('\n').slice(0, 2);
            const preview = previewLines.map(line =>
                line.length > 40 ? line.substring(0, 40) + '...' : line
            ).join('\n');
            const hasMore = selection.split('\n').length > 2;

            // Check if this selection is already added
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
            // No current selection
            if (claudeCodeSelections.length === 0 && claudeEditMode === 'selection') {
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

    // Update selections display
    renderCodeSelections();
}

// Auto-detect mode based on selections
function autoDetectClaudeMode() {
    // If there are saved selections, auto-switch to selection mode
    if (claudeCodeSelections.length > 0 && claudeEditMode !== 'selection') {
        setClaudeModeQuiet('selection');
    }
    // If user has current selection and no saved selections, also switch to selection mode
    else if (texEditor) {
        const selection = texEditor.getSelection();
        if (selection && selection.length > 0 && claudeCodeSelections.length === 0 && claudeEditMode !== 'selection') {
            // Only auto-switch if panel is open
            if (isClaudeAIPanelOpen) {
                setClaudeModeQuiet('selection');
            }
        }
    }
}

// Set mode without triggering full update (to avoid infinite loop)
function setClaudeModeQuiet(mode) {
    claudeEditMode = mode;

    const selTab = document.getElementById('claude-ai-tab-selection');
    const fileTab = document.getElementById('claude-ai-tab-file');

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
    if (!texEditor) return;

    const selection = texEditor.getSelection();
    if (!selection || selection.length === 0) return;

    const from = texEditor.getCursor('from');
    const to = texEditor.getCursor('to');

    // Check if already added
    if (isSelectionAlreadyAdded(from, to)) {
        showNotification('This selection is already added', 2000);
        return;
    }

    // Create selection object
    const selectionObj = {
        id: ++selectionIdCounter,
        text: selection,
        from: { line: from.line, ch: from.ch },
        to: { line: to.line, ch: to.ch },
        lineCount: selection.split('\n').length,
        preview: createSelectionPreview(selection)
    };

    claudeCodeSelections.push(selectionObj);

    // Auto-switch to selection mode
    setClaudeModeQuiet('selection');

    // Update display
    updateClaudeSelectionInfo();

    showNotification(`Selection added (Lines ${from.line + 1}-${to.line + 1})`, 2000);
}

// Create a short preview of selection text
function createSelectionPreview(text) {
    const firstLine = text.split('\n')[0];
    return firstLine.length > 30 ? firstLine.substring(0, 30) + '...' : firstLine;
}

// Remove a selection from the list
function removeCodeSelection(id) {
    claudeCodeSelections = claudeCodeSelections.filter(sel => sel.id !== id);

    // If no selections left and in selection mode, check if we should switch
    if (claudeCodeSelections.length === 0) {
        // Stay in selection mode if user has current selection
        const selection = texEditor ? texEditor.getSelection() : '';
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
    const container = document.getElementById('claude-ai-selections');
    const badge = document.getElementById('selection-count-badge');

    if (!container) return;

    // Update badge
    if (badge) {
        if (claudeCodeSelections.length > 0) {
            badge.textContent = claudeCodeSelections.length;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

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
            ${claudeCodeSelections.map(sel => `
                <div class="code-selection-chip" data-id="${sel.id}">
                    <div class="code-selection-info">
                        <span class="code-selection-lines">
                            <i class="fas fa-code"></i> Lines ${sel.from.line + 1}-${sel.to.line + 1}
                        </span>
                        <span class="code-selection-preview">${escapeHtml(sel.preview)}</span>
                    </div>
                    <button class="remove-selection-btn" onclick="removeCodeSelection(${sel.id})" title="Remove">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `).join('')}
        </div>
    `;
}

// Handle keydown in custom prompt input (legacy function)
function handleClaudeCustomKeydown(event) {
    handleClaudeAIKeydown(event);
}

// Handle keydown in Claude AI panel input
function handleClaudeAIKeydown(event) {
    const autocomplete = document.getElementById('claude-ai-autocomplete') || document.getElementById('claude-file-autocomplete');
    const isAutocompleteVisible = autocomplete && autocomplete.classList.contains('visible');

    if (isAutocompleteVisible) {
        const items = autocomplete.querySelectorAll('.autocomplete-item, .claude-ai-autocomplete-item');
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
            toggleClaudeAIPanel();
        }
    }
}

// Handle input changes in legacy input (auto-resize and @ detection)
function handleClaudeInputChange(textarea) {
    handleClaudeAIInputChange(textarea);
}

// Handle input changes in Claude AI panel (auto-resize and @ detection)
function handleClaudeAIInputChange(textarea) {
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
        showFileAutocomplete(query, textarea.id === 'claude-ai-input');
    } else {
        hideAutocomplete();
    }
}

// ============================================================================
// CLAUDE AI PANEL - IMAGE SUPPORT
// ============================================================================

// Handle paste event for images and YouTube URLs in Claude AI panel
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

    // Check for YouTube URL in pasted text
    const pastedText = event.clipboardData.getData('text');
    if (pastedText) {
        const youtubeMatch = pastedText.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/);
        if (youtubeMatch) {
            event.preventDefault();
            const videoId = youtubeMatch[1];
            showTexYouTubeLanguageModal(videoId);
        }
    }
}

// Handle image file selection via button
function handleClaudeImageSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        addClaudeImage(file);
    }
    // Reset input so same file can be selected again
    event.target.value = '';
}

// Add image to the Claude AI panel
function addClaudeImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        claudePastedImages.push({
            data: base64,
            name: file.name || 'pasted-image.png',
            type: file.type
        });
        renderClaudeImagePreviews();
    };
    reader.readAsDataURL(file);
}

// Render image previews in the Claude AI panel
function renderClaudeImagePreviews() {
    const container = document.getElementById('claude-ai-images');
    if (!container) return;

    if (claudePastedImages.length === 0) {
        container.classList.remove('has-images');
        container.innerHTML = '';
        return;
    }

    container.classList.add('has-images');
    container.innerHTML = claudePastedImages.map((img, i) => `
        <div class="claude-ai-image-item">
            <img src="${img.data}" alt="${img.name}">
            <button class="claude-ai-image-remove" onclick="removeClaudeImage(${i})" title="Remove image">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Remove an image from Claude AI panel
function removeClaudeImage(index) {
    claudePastedImages.splice(index, 1);
    renderClaudeImagePreviews();
}

// ============================================================================
// CLAUDE AI PANEL - YOUTUBE TRANSCRIPTS
// ============================================================================

// Show modal to select language for YouTube video (TeX editor version)
function showTexYouTubeLanguageModal(videoId) {
    // Remove any existing modal
    const existingModal = document.getElementById('tex-youtube-lang-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'tex-youtube-lang-modal';
    modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #252528;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 16px;
        padding: 24px;
        z-index: 100002;
        min-width: 320px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    `;

    modal.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <i class="fab fa-youtube" style="color: #FF0000; font-size: 24px;"></i>
            <div>
                <div style="color: #fff; font-size: 15px; font-weight: 600;">YouTube Video Detected</div>
                <div style="color: #8e8e93; font-size: 12px; margin-top: 2px;">ID: ${videoId}</div>
            </div>
        </div>
        <div style="color: #c0c0c0; font-size: 13px; margin-bottom: 16px;">
            Select transcript language:
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
            <button onclick="addTexYouTubeTranscript('${videoId}', 'auto')" style="padding: 12px 16px; background: linear-gradient(135deg, #F59E0B, #D97706); border: none; border-radius: 8px; color: #fff; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-magic"></i> Auto-detect (Recommended)
            </button>
            <button onclick="addTexYouTubeTranscript('${videoId}', 'en')" style="padding: 12px 16px; background: #3c3c3c; border: 1px solid #4c4c4c; border-radius: 8px; color: #e0e0e0; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 16px;">🇬🇧</span> English
            </button>
            <button onclick="addTexYouTubeTranscript('${videoId}', 'hi')" style="padding: 12px 16px; background: #3c3c3c; border: 1px solid #4c4c4c; border-radius: 8px; color: #e0e0e0; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 16px;">🇮🇳</span> Hindi (YouTube captions)
            </button>
            <button onclick="addTexYouTubeTranscript('${videoId}', 'hi-whisper')" style="padding: 12px 16px; background: linear-gradient(135deg, #8B5CF6, #6D28D9); border: none; border-radius: 8px; color: #fff; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-robot"></i> Hindi → English (AI Whisper)
            </button>
        </div>
        <div style="margin-top: 12px; padding: 10px; background: rgba(139, 92, 246, 0.1); border-radius: 8px; font-size: 11px; color: #a78bfa;">
            <i class="fas fa-info-circle"></i> AI Whisper downloads audio & translates Hindi speech to English. Takes 1-3 min but gives best quality for Hindi videos.
        </div>
        <button onclick="document.getElementById('tex-youtube-lang-modal').remove()" style="width: 100%; margin-top: 12px; padding: 10px; background: none; border: 1px solid #4c4c4c; border-radius: 8px; color: #8e8e93; font-size: 13px; cursor: pointer;">
            Cancel
        </button>
    `;

    document.body.appendChild(modal);
}

// Add YouTube transcript from the language modal (TeX editor version)
async function addTexYouTubeTranscript(videoId, language) {
    const modal = document.getElementById('tex-youtube-lang-modal');

    // Check if already added
    if (claudeYoutubeTranscripts.find(t => t.videoId === videoId)) {
        if (modal) modal.remove();
        showNotification('YouTube transcript already added', 2000);
        return;
    }

    // Show loading state
    const isWhisper = language === 'hi-whisper';
    if (modal) {
        modal.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <i class="fas fa-${isWhisper ? 'robot' : 'spinner'} fa-spin" style="font-size: 32px; color: ${isWhisper ? '#8B5CF6' : '#F59E0B'}; margin-bottom: 12px;"></i>
                <div style="color: #e0e0e0; font-size: 14px;">${isWhisper ? 'AI transcribing Hindi → English...' : 'Fetching transcript...'}</div>
                ${isWhisper ? '<div style="color: #8e8e93; font-size: 11px; margin-top: 8px;">Downloading audio & processing (1-3 min)</div>' : ''}
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

        // Add to YouTube transcripts array
        claudeYoutubeTranscripts.push({
            videoId: data.videoId,
            language: data.language,
            transcript: data.fullText,
            lineCount: data.lineCount
        });

        // Update display
        renderTexYoutubeRefs();

        // Close modal and show success
        if (modal) modal.remove();
        showNotification(`YouTube transcript added (${data.lineCount} lines)`, 2000);

    } catch (error) {
        console.error('YouTube transcript error:', error);
        if (modal) {
            modal.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <i class="fas fa-exclamation-circle" style="font-size: 32px; color: #FF6B6B; margin-bottom: 12px;"></i>
                    <div style="color: #e0e0e0; font-size: 14px; margin-bottom: 8px;">Failed to fetch transcript</div>
                    <div style="color: #8e8e93; font-size: 12px; margin-bottom: 16px;">${error.message}</div>
                    <button onclick="document.getElementById('tex-youtube-lang-modal').remove()" style="padding: 10px 20px; background: #3c3c3c; border: none; border-radius: 8px; color: #e0e0e0; cursor: pointer;">
                        Close
                    </button>
                </div>
            `;
        }
    }
}

// Render YouTube transcript references in the Claude AI panel
function renderTexYoutubeRefs() {
    const container = document.getElementById('claude-ai-refs');
    if (!container) return;

    // Combine regular file refs with YouTube refs
    const regularHtml = claudeReferencedFiles.length === 0 ? '' : `
        ${claudeReferencedFiles.map(file => {
            const isPdf = file.type === 'pdf';
            const hasPages = file.selectedPages && file.selectedPages.length > 0;
            const pageInfo = hasPages ? ` (p${formatTexPageRange(file.selectedPages)})` : '';
            const originalPath = file.originalPath || file.path;
            return `
            <span class="referenced-file-tag ${hasPages ? 'has-pages' : ''}" data-path="${originalPath}">
                <i class="fas ${isPdf ? 'fa-file-pdf' : 'fa-file-code'}"></i>
                ${file.name}${pageInfo}
                ${isPdf ? `
                    <button onclick="openTexPageSelector('${originalPath}', '${file.name}')" class="select-pages-ref-btn" title="Select specific pages">
                        <i class="fas fa-layer-group"></i>
                    </button>
                ` : ''}
                <button onclick="removeReferencedFile('${originalPath}')" class="remove-ref-btn">
                    <i class="fas fa-times"></i>
                </button>
            </span>
        `}).join('')}
    `;

    const youtubeHtml = claudeYoutubeTranscripts.map(yt => `
        <span class="referenced-file-tag youtube-ref" data-video-id="${yt.videoId}">
            <i class="fab fa-youtube" style="color: #FF0000;"></i>
            YouTube: ${yt.videoId}
            <button onclick="removeTexYoutubeRef('${yt.videoId}')" class="remove-ref-btn">
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
            ${regularHtml}
            ${youtubeHtml}
        </div>
    ` : '';

    container.classList.toggle('has-refs', hasRefs);
}

// Remove a YouTube transcript reference
function removeTexYoutubeRef(videoId) {
    claudeYoutubeTranscripts = claudeYoutubeTranscripts.filter(t => t.videoId !== videoId);
    renderTexYoutubeRefs();
}

// ============================================================================
// CLAUDE AI PANEL - MESSAGES
// ============================================================================

// Add message to the AI panel messages area
function addAIMessage(text, type = 'system', images = []) {
    const messagesEl = document.getElementById('claude-ai-messages');
    if (!messagesEl) return;

    // Hide empty state
    const emptyState = document.getElementById('claude-ai-empty-state');
    if (emptyState) emptyState.style.display = 'none';

    const msg = document.createElement('div');
    msg.className = `claude-ai-message ${type}`;

    let content = '';

    // Add images if present
    if (images && images.length > 0) {
        content += `<div class="ai-message-images">
            ${images.map(img => `<img src="${img.data}" alt="${img.name}">`).join('')}
        </div>`;
    }

    // Add text
    content += `<div class="ai-message-text">${escapeHtml(text)}</div>`;

    msg.innerHTML = content;
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Clear AI panel messages
function clearAIMessages() {
    const messagesEl = document.getElementById('claude-ai-messages');
    if (messagesEl) {
        messagesEl.innerHTML = `
            <div class="claude-ai-empty-state" id="claude-ai-empty-state">
                <i class="fas fa-magic"></i>
                <p>Select a quick action above or type a custom instruction below</p>
            </div>
        `;
    }
}

// Update progress indicator in AI panel (for diff mode changes)
function updateAIProgress(text) {
    const messagesEl = document.getElementById('claude-ai-messages');
    if (!messagesEl) return;

    // Find or create progress element
    let progressEl = messagesEl.querySelector('.claude-ai-progress');
    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'claude-ai-progress';
        messagesEl.appendChild(progressEl);
    }

    progressEl.innerHTML = `
        <div class="ai-progress-indicator">
            <i class="fas fa-spinner fa-spin"></i>
            <span>${escapeHtml(text)}</span>
        </div>
    `;
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Remove progress indicator from AI panel
function clearAIProgress() {
    const progressEl = document.querySelector('.claude-ai-progress');
    if (progressEl) progressEl.remove();
}

// Append live streaming output to AI panel (real-time terminal output)
function appendLiveToAIPanel(text) {
    const messagesEl = document.getElementById('claude-ai-messages');
    if (!messagesEl) return;

    // Hide empty state
    const emptyState = document.getElementById('claude-ai-empty-state');
    if (emptyState) emptyState.style.display = 'none';

    // Find or create the live output container
    let liveContainer = messagesEl.querySelector('.claude-ai-live-output');
    if (!liveContainer) {
        liveContainer = document.createElement('div');
        liveContainer.className = 'claude-ai-live-output';
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

    // Append the new line to live output
    const contentEl = liveContainer.querySelector('.live-output-content');
    if (contentEl) {
        const line = document.createElement('div');
        line.className = 'live-output-line';
        line.textContent = text;
        contentEl.appendChild(line);

        // Keep only last 50 lines to prevent memory issues
        while (contentEl.children.length > 50) {
            contentEl.removeChild(contentEl.firstChild);
        }

        // Auto-scroll to bottom
        contentEl.scrollTop = contentEl.scrollHeight;
    }

    // Scroll messages area too
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Clear live output container when done
function clearLiveOutput() {
    const liveContainer = document.querySelector('.claude-ai-live-output');
    if (liveContainer) liveContainer.remove();
}

// Load subject files for @ autocomplete
async function loadSubjectFilesForAutocomplete() {
    if (!currentTexFile || !currentTexFile.path) return;

    // Extract subject from path (e.g., subjects/DBS/notes/...)
    const pathParts = currentTexFile.path.split('/');
    const subjectIndex = pathParts.indexOf('subjects');
    if (subjectIndex === -1 || subjectIndex + 1 >= pathParts.length) return;

    const subject = pathParts[subjectIndex + 1];

    try {
        const response = await fetch(`/api/subject-files/${subject}`);
        if (response.ok) {
            claudeSubjectFiles = await response.json();
        }
    } catch (error) {
        console.error('Failed to load subject files:', error);
    }
}

// Show file autocomplete dropdown
function showFileAutocomplete(query, useNewPanel = false) {
    const autocomplete = useNewPanel
        ? document.getElementById('claude-ai-autocomplete')
        : (document.getElementById('claude-ai-autocomplete') || document.getElementById('claude-file-autocomplete'));
    if (!autocomplete) return;

    const filtered = claudeSubjectFiles.filter(f =>
        f.name.toLowerCase().includes(query) ||
        f.path.toLowerCase().includes(query)
    ).slice(0, 8);

    if (filtered.length === 0) {
        hideAutocomplete();
        return;
    }

    autocomplete.innerHTML = filtered.map((file, index) => `
        <div class="autocomplete-item claude-ai-autocomplete-item ${index === 0 ? 'selected' : ''}" data-file="${file.path}" onclick="selectAutocompleteFile('${file.path}')">
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
    // Hide both old and new autocomplete elements
    const oldAutocomplete = document.getElementById('claude-file-autocomplete');
    const newAutocomplete = document.getElementById('claude-ai-autocomplete');

    if (oldAutocomplete) {
        oldAutocomplete.classList.remove('visible');
    }
    if (newAutocomplete) {
        newAutocomplete.classList.remove('visible');
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
    // Try new input first, then fall back to old
    const textarea = document.getElementById('claude-ai-input') || document.getElementById('claude-custom-input');
    if (!textarea) return;

    const value = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const textAfterCursor = value.substring(cursorPos);

    // Replace @query with @filename and add a space after
    const newTextBefore = textBeforeCursor.replace(/@[^\s@]*$/, '');
    const fileName = filePath.split('/').pop();

    // Build new value with proper spacing
    const insertedText = '@' + fileName + ' ';
    const newValue = newTextBefore + insertedText + textAfterCursor.trimStart();
    textarea.value = newValue;

    // Set cursor position after the inserted file reference and space
    const newCursorPos = newTextBefore.length + insertedText.length;
    textarea.setSelectionRange(newCursorPos, newCursorPos);
    textarea.focus();

    // Add to referenced files if not already
    if (!claudeReferencedFiles.find(f => f.path === filePath)) {
        const fileInfo = claudeSubjectFiles.find(f => f.path === filePath);
        if (fileInfo) {
            claudeReferencedFiles.push(fileInfo);
            updateReferencedFilesDisplay();
        }
    }

    hideAutocomplete();

    // Trigger input change to resize textarea
    if (textarea.id === 'claude-ai-input') {
        handleClaudeAIInputChange(textarea);
    } else {
        handleClaudeInputChange(textarea);
    }
}

// Update the referenced files display (both old and new panel)
function updateReferencedFilesDisplay() {
    const oldContainer = document.getElementById('claude-referenced-files');

    // Old container only shows file refs (legacy)
    const html = claudeReferencedFiles.length === 0 ? '' : `
        <div class="referenced-files-header">
            <i class="fas fa-paperclip"></i> Referenced files:
        </div>
        <div class="referenced-files-list">
            ${claudeReferencedFiles.map(file => {
                const isPdf = file.type === 'pdf';
                const hasPages = file.selectedPages && file.selectedPages.length > 0;
                const pageInfo = hasPages ? ` (p${formatTexPageRange(file.selectedPages)})` : '';
                const originalPath = file.originalPath || file.path;

                return `
                <span class="referenced-file-tag ${hasPages ? 'has-pages' : ''}" data-path="${originalPath}">
                    <i class="fas ${isPdf ? 'fa-file-pdf' : 'fa-file-code'}"></i>
                    ${file.name}${pageInfo}
                    ${isPdf ? `
                        <button onclick="openTexPageSelector('${originalPath}', '${file.name}')" class="select-pages-ref-btn" title="Select specific pages">
                            <i class="fas fa-layer-group"></i>
                        </button>
                    ` : ''}
                    <button onclick="removeReferencedFile('${originalPath}')" class="remove-ref-btn">
                        <i class="fas fa-times"></i>
                    </button>
                </span>
            `}).join('')}
        </div>
    `;

    // Update old container (legacy)
    if (oldContainer) {
        oldContainer.innerHTML = html;
        oldContainer.style.display = claudeReferencedFiles.length === 0 ? 'none' : 'block';
    }

    // New container uses combined render with YouTube refs
    renderTexYoutubeRefs();
}

// Format page range for display in TeX editor
function formatTexPageRange(pages) {
    if (!pages || pages.length === 0) return '';
    const sorted = [...pages].sort((a, b) => a - b);
    const ranges = [];
    let start = sorted[0];
    let end = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
        } else {
            ranges.push(start === end ? `${start}` : `${start}-${end}`);
            start = sorted[i];
            end = sorted[i];
        }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return ranges.join(',');
}

// Open page selector for a TeX editor reference
function openTexPageSelector(filePath, fileName) {
    if (typeof openPageSelector === 'function') {
        openPageSelector(filePath, fileName, handleTexPageSelection, 'tex');
    } else {
        console.error('Page selector not available');
    }
}

// Handle page selection callback for TeX editor
function handleTexPageSelection(result) {
    // Find and update the referenced file
    const index = claudeReferencedFiles.findIndex(f => (f.originalPath || f.path) === result.originalPath);
    if (index !== -1) {
        // Update with extraction info
        claudeReferencedFiles[index] = {
            ...claudeReferencedFiles[index],
            path: result.path,
            originalPath: result.originalPath,
            name: result.originalName,
            selectedPages: result.pages,
            isExtracted: result.isExtracted
        };
        updateReferencedFilesDisplay();
    }
}

// Remove a referenced file
function removeReferencedFile(filePath) {
    claudeReferencedFiles = claudeReferencedFiles.filter(f => (f.originalPath || f.path) !== filePath);
    updateReferencedFilesDisplay();
}

// Run Claude action on selected text or entire file
async function runClaudeAction(action) {
    if (!texEditor) return;

    // Check state
    if (claudeEditState !== ClaudeEditState.IDLE) {
        showNotification('Claude is already running. Please wait.', 3000);
        return;
    }

    // Determine what to edit based on mode
    const isFileMode = claudeEditMode === 'file';
    const currentSelection = texEditor.getSelection();

    // In selection mode, need either saved selections or current selection
    if (!isFileMode) {
        const hasSelections = claudeCodeSelections.length > 0;
        const hasCurrentSelection = currentSelection && currentSelection.length > 0;

        if (!hasSelections && !hasCurrentSelection) {
            showNotification('Please add at least one code selection', 3000);
            return;
        }

        // If there's a current selection not yet added, auto-add it
        if (hasCurrentSelection && !isSelectionAlreadyAdded(
            texEditor.getCursor('from'),
            texEditor.getCursor('to')
        )) {
            addCurrentSelection();
        }
    }

    // Get custom prompt if action is 'custom'
    let customPrompt = '';
    if (action === 'custom') {
        // Try new input first, then fall back to old
        const customInput = document.getElementById('claude-ai-input') || document.getElementById('claude-custom-input');
        customPrompt = customInput ? customInput.value.trim() : '';
        if (!customPrompt) {
            showNotification('Please enter a custom instruction', 3000);
            return;
        }
    }

    // Clear both old and new input elements
    const newInputEl = document.getElementById('claude-ai-input');
    const oldInputEl = document.getElementById('claude-custom-input');
    if (newInputEl) {
        newInputEl.value = '';
        newInputEl.style.height = 'auto';
    }
    if (oldInputEl) {
        oldInputEl.value = '';
        oldInputEl.style.height = 'auto';
    }

    // Save referenced files paths before clearing
    const referencedFilePaths = claudeReferencedFiles.map(f => f.path);
    const referencedFileNames = claudeReferencedFiles.map(f => f.name);

    // Save code selections before clearing
    const codeSelectionsToSend = [...claudeCodeSelections];

    // Save images before clearing
    const imagesToSend = [...claudePastedImages];

    // Save YouTube transcripts before clearing
    const youtubeTranscriptsToSend = [...claudeYoutubeTranscripts];

    // Clear referenced files, code selections, images, and YouTube transcripts
    claudeReferencedFiles = [];
    claudeYoutubeTranscripts = [];
    renderTexYoutubeRefs();
    claudeCodeSelections = [];
    renderCodeSelections();
    claudePastedImages = [];
    renderClaudeImagePreviews();

    // Hide empty state in messages area
    const emptyState = document.getElementById('claude-ai-empty-state');
    if (emptyState) emptyState.style.display = 'none';

    // Save original content for instant revert
    claudeEditBackup.originalContent = texEditor.getValue();
    claudeEditBackup.originalPdfPath = associatedPdfPath;

    // Update state
    claudeEditState = ClaudeEditState.RUNNING;
    isClaudeRunning = true;

    // Track action for version saving
    claudeCurrentAction = action;
    claudeCurrentCustomPrompt = customPrompt;

    // Show terminal panel with enhanced header
    showClaudeTerminal();
    clearClaudeTerminal();

    // Add user request to chat
    const selectionCountText = codeSelectionsToSend.length > 1
        ? `${codeSelectionsToSend.length} selections`
        : 'selection';
    const userRequest = action === 'custom' ? customPrompt : `${action} the ${isFileMode ? 'entire file' : selectionCountText}`;
    addChatMessage(userRequest, 'user');

    appendClaudeOutput('═══════════════════════════════════════════', 'header');
    appendClaudeOutput('  CLAUDE EDIT SESSION STARTED', 'header');
    appendClaudeOutput('═══════════════════════════════════════════', 'header');
    appendClaudeOutput(`Action: ${action}`, 'info');
    if (isFileMode) {
        const fullContent = texEditor.getValue();
        appendClaudeOutput(`Mode: Entire File (${fullContent.split('\n').length} lines)`, 'info');
    } else {
        const totalLines = codeSelectionsToSend.reduce((sum, sel) => sum + sel.lineCount, 0);
        appendClaudeOutput(`Mode: ${codeSelectionsToSend.length} Selection(s) (${totalLines} total lines)`, 'info');
        codeSelectionsToSend.forEach((sel, i) => {
            appendClaudeOutput(`  ${i + 1}. Lines ${sel.from.line + 1}-${sel.to.line + 1}`, 'info');
        });
    }
    appendClaudeOutput('', 'info');
    updateClaudeStopButton(true);

    // Log referenced files
    if (referencedFilePaths.length > 0) {
        appendClaudeOutput(`Referenced files: ${referencedFileNames.join(', ')}`, 'info');
    }

    // Log YouTube transcripts
    if (youtubeTranscriptsToSend.length > 0) {
        appendClaudeOutput(`YouTube transcripts: ${youtubeTranscriptsToSend.map(t => t.videoId).join(', ')}`, 'info');
    }

    // Log images
    if (imagesToSend.length > 0) {
        appendClaudeOutput(`Attached images: ${imagesToSend.length}`, 'info');
    }

    // Add user message to AI panel
    addAIMessage(userRequest, 'user', imagesToSend);

    try {
        const response = await fetch('/api/claude-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                texPath: currentTexFile.path,
                // Send code selections array instead of single selection
                codeSelections: isFileMode ? null : codeSelectionsToSend.map(sel => ({
                    text: sel.text,
                    from: sel.from,
                    to: sel.to,
                    lineCount: sel.lineCount
                })),
                action: action,
                customPrompt: customPrompt,
                fullContent: texEditor.getValue(),
                editMode: claudeEditMode,
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
        appendClaudeOutput(`❌ Error: ${error.message}`, 'error');
        resetClaudeState();
    }
}

// Handle SSE message from Claude API
function handleClaudeSSEMessage(data) {
    switch (data.type) {
        case 'backup':
            claudeEditBackup.backupTexPath = data.backupPath;
            claudeEditBackup.backupPdfPath = data.oldPdfPath;
            appendClaudeOutput('📁 Backup created', 'info');
            break;

        case 'claude-start':
            // Show spinner in terminal and AI panel
            showClaudeSpinner();
            updateAIProgress('Claude is thinking...');
            break;

        case 'claude-done':
            // Hide spinner
            hideClaudeSpinner();
            break;

        case 'change-applied':
            // Show progress for each applied change (diff mode)
            appendClaudeOutput(`  ✓ Change ${data.index}/${data.total}: ${data.preview}${data.fuzzy ? ' (fuzzy match)' : ''}`, 'success');
            // Also update AI panel with change info
            updateAIProgress(`Applying changes: ${data.index}/${data.total}`);
            break;

        case 'change-failed':
            // Show warning for failed change
            appendClaudeOutput(`  ✗ Change ${data.index}/${data.total}: Could not find "${data.preview}"`, 'warning');
            break;

        case 'progress':
            // Update the progress message (replace last line)
            updateClaudeProgress(data.data);
            break;

        case 'output':
            appendClaudeOutput(data.data, 'output');
            break;

        case 'live-output':
            // LIVE streaming from PTY - show in both terminal AND AI panel
            appendClaudeOutput(data.data, 'live');
            appendLiveToAIPanel(data.data);
            break;

        case 'result':
            // Clear progress indicator and live output
            clearAIProgress();
            clearLiveOutput();

            if (data.newContent && texEditor) {
                if (data.editMode === 'file') {
                    // File mode: replace entire content
                    texEditor.setValue(data.newContent);
                    if (data.noChanges) {
                        appendClaudeOutput('⚠ No changes were made', 'warning');
                        addAIMessage('No changes were applied', 'warning');
                    } else if (data.toolMode) {
                        appendClaudeOutput('✓ Claude edited the file directly', 'success');
                        addAIMessage('File edited successfully', 'success');
                    } else if (data.diffMode) {
                        appendClaudeOutput(`✓ ${data.changesApplied} change(s) applied to editor`, 'success');
                        if (data.changesFailed > 0) {
                            addAIMessage(`Applied ${data.changesApplied} changes (${data.changesFailed} failed)`, 'warning');
                        } else {
                            addAIMessage(`Applied ${data.changesApplied} changes successfully`, 'success');
                        }
                    } else {
                        appendClaudeOutput('✓ File updated in editor', 'success');
                        addAIMessage('File updated successfully', 'success');
                    }
                } else if (data.isMultiSelection) {
                    // Multi-selection mode: replace entire content (backend already applied all changes)
                    texEditor.setValue(data.newContent);
                    const selCount = data.selections ? data.selections.length : 'multiple';
                    appendClaudeOutput(`✓ ${selCount} selections updated in editor`, 'success');
                    // Clear the selections since they've been applied
                    clearAllCodeSelections();
                } else {
                    // Single selection mode: replace the selection
                    const from = data.selectionRange.from;
                    const to = data.selectionRange.to;
                    texEditor.replaceRange(data.newContent, from, to);
                    appendClaudeOutput('✓ Selection updated in editor', 'success');
                    // Clear the selections since they've been applied
                    clearAllCodeSelections();
                }
                isTexModified = true;
                updateTexStatus('modified', 'Modified by Claude');

                // Save Claude version to version control
                const fullContent = texEditor.getValue();
                saveClaudeVersion(fullContent, claudeCurrentAction, claudeCurrentCustomPrompt);
            }
            break;

        case 'compile-start':
            claudeEditState = ClaudeEditState.COMPILING;
            appendClaudeOutput('', 'info');
            appendClaudeOutput('───────────────────────────────────────────', 'info');
            appendClaudeOutput('  COMPILING LATEX (2 passes for TOC)', 'info');
            appendClaudeOutput('───────────────────────────────────────────', 'info');
            break;

        case 'compile-progress':
            appendClaudeOutput(`⚙ ${data.message}`, 'info');
            break;

        case 'compile-done':
            claudeEditBackup.newPdfPath = data.pdfPath;
            appendClaudeOutput('✓ PDF compiled successfully', 'success');
            break;

        case 'compare':
            claudeEditState = ClaudeEditState.REVIEWING;
            appendClaudeOutput('', 'info');
            appendClaudeOutput('═══════════════════════════════════════════', 'header');
            appendClaudeOutput('  REVIEW CHANGES', 'header');
            appendClaudeOutput('═══════════════════════════════════════════', 'header');
            appendClaudeOutput('', 'info');
            // Show the review panel instead of modal
            showClaudeReviewPanel(data.oldPdfPath, data.newPdfPath, data.backupPath);
            break;

        case 'complete':
            hideClaudeSpinner();
            if (claudeEditState !== ClaudeEditState.REVIEWING) {
                // No comparison, just done
                appendClaudeOutput('', 'info');
                appendClaudeOutput('✓ Process complete', 'success');
                resetClaudeState();
            }
            updateClaudeStopButton(false);
            isClaudeRunning = false;
            break;

        case 'error':
            hideClaudeSpinner();
            appendClaudeOutput(`❌ ${data.message}`, 'error');
            resetClaudeState();
            break;
    }
}

// Show spinner while Claude is thinking
function showClaudeSpinner() {
    const content = document.getElementById('claude-terminal-content');
    if (!content) return;

    // Remove existing spinner
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
    if (spinner) {
        spinner.remove();
    }
}

// Update progress message (replaces spinner text)
function updateClaudeProgress(message) {
    const spinnerText = document.querySelector('#claude-spinner .spinner-text');
    if (spinnerText) {
        spinnerText.textContent = message;
    }
    // Also add to output for history
    const content = document.getElementById('claude-terminal-content');
    if (content) {
        content.scrollTop = content.scrollHeight;
    }
}

// Reset Claude state
function resetClaudeState() {
    claudeEditState = ClaudeEditState.IDLE;
    isClaudeRunning = false;
    updateClaudeStopButton(false);
}

// Show Claude terminal panel and open chat panel
function showClaudeTerminal() {
    const panel = document.getElementById('claude-terminal-panel');
    if (panel) {
        panel.classList.add('visible');
    }
    // Also open the chat side panel
    openClaudeChatPanel();
}

// Close Claude terminal panel
function closeClaudeTerminal() {
    const panel = document.getElementById('claude-terminal-panel');
    if (panel) {
        panel.classList.remove('visible');
    }
    // Show toggle button so user can reopen chat
    showChatToggle();
}

// Clear Claude terminal and chat
function clearClaudeTerminal() {
    const content = document.getElementById('claude-terminal-content');
    if (content) {
        content.innerHTML = '';
    }
    clearChatMessages();
}

// Append output to Claude terminal and panels
function appendClaudeOutput(text, type = 'output') {
    // Terminal output
    const content = document.getElementById('claude-terminal-content');
    if (content) {
        const line = document.createElement('div');
        line.className = `claude-terminal-line ${type}`;
        line.textContent = text;
        content.appendChild(line);
        content.scrollTop = content.scrollHeight;
    }

    // Also add to chat panel and AI panel (skip header decorations)
    if (text && !text.match(/^[═─]+$/)) {
        let msgType = 'system';
        if (type === 'error') msgType = 'error';
        else if (type === 'success') msgType = 'success';
        else if (type === 'output') msgType = 'assistant';

        // Old chat panel
        addChatMessage(text, msgType);

        // New AI panel
        addAIMessage(text, msgType);
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
        appendClaudeOutput('⚠ Stopped by user', 'warning');
    } catch (error) {
        appendClaudeOutput(`❌ Error stopping: ${error.message}`, 'error');
    }

    resetClaudeState();
}

// ============================================================================
// CLAUDE CHAT SIDE PANEL
// ============================================================================

// Toggle chat panel visibility
function toggleClaudeChatPanel() {
    const panel = document.getElementById('claude-chat-panel');
    const toggle = document.getElementById('claude-chat-toggle');

    if (panel) {
        isClaudeChatPanelOpen = !isClaudeChatPanelOpen;
        panel.classList.toggle('open', isClaudeChatPanelOpen);

        if (toggle) {
            toggle.classList.toggle('visible', !isClaudeChatPanelOpen);
        }
    }
}

// Open chat panel
function openClaudeChatPanel() {
    const panel = document.getElementById('claude-chat-panel');
    const toggle = document.getElementById('claude-chat-toggle');

    if (panel && !isClaudeChatPanelOpen) {
        isClaudeChatPanelOpen = true;
        panel.classList.add('open');
        if (toggle) toggle.classList.remove('visible');
    }
}

// Show toggle button (when chat has content)
function showChatToggle() {
    const toggle = document.getElementById('claude-chat-toggle');
    if (toggle && !isClaudeChatPanelOpen) {
        toggle.classList.add('visible');
    }
}

// Clear chat messages
function clearChatMessages() {
    const messages = document.getElementById('claude-chat-messages');
    if (messages) {
        messages.innerHTML = '';
    }
}

// Add message to chat panel
function addChatMessage(text, type = 'system') {
    const messages = document.getElementById('claude-chat-messages');
    if (!messages) return;

    const msg = document.createElement('div');
    msg.className = `chat-message ${type}`;
    msg.textContent = text;
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
}

// ============================================================================
// CLAUDE REVIEW PANEL
// ============================================================================

// State for viewing original
let isViewingOriginal = false;
let currentEditorContent = null;

// Diff navigation state
let diffChangeIndices = [];
let currentDiffIndex = 0;

// Show review panel with controls
function showClaudeReviewPanel(oldPdfPath, newPdfPath, backupPath) {
    // Store paths
    claudeEditBackup.backupTexPath = backupPath;
    claudeEditBackup.backupPdfPath = oldPdfPath;
    claudeEditBackup.newPdfPath = newPdfPath;

    // Add review controls to terminal
    const content = document.getElementById('claude-terminal-content');
    if (!content) return;

    const reviewDiv = document.createElement('div');
    reviewDiv.className = 'claude-review-controls';
    reviewDiv.innerHTML = `
        <div class="claude-review-buttons">
            <button class="claude-review-btn view-original" onclick="toggleViewOriginal()">
                <i class="fas fa-history"></i> View Original Code
            </button>
            <button class="claude-review-btn diff" onclick="showTextDiff()">
                <i class="fas fa-code-compare"></i> Show Diff
            </button>
            <button class="claude-review-btn history" onclick="showVersionHistory()">
                <i class="fas fa-clock-rotate-left"></i> History
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

    // Refresh PDF to show new version
    if (newPdfPath) {
        refreshPdfPreview(newPdfPath);
    }

    appendClaudeOutput('Review your changes above. PDF preview shows the new version.', 'info');
}

// Toggle viewing original code in editor
function toggleViewOriginal() {
    if (!texEditor || !claudeEditBackup.originalContent) return;

    const btn = document.querySelector('.claude-review-btn.view-original');

    if (!isViewingOriginal) {
        // Save current content and show original
        currentEditorContent = texEditor.getValue();
        texEditor.setValue(claudeEditBackup.originalContent);
        texEditor.setOption('readOnly', true);
        isViewingOriginal = true;

        // Update button
        if (btn) {
            btn.innerHTML = '<i class="fas fa-times"></i> Close Original';
            btn.classList.add('active');
        }

        // Show banner
        showOriginalBanner();
        appendClaudeOutput('👁 Viewing original code (read-only)', 'info');
    } else {
        // Restore current content
        texEditor.setValue(currentEditorContent);
        texEditor.setOption('readOnly', false);
        isViewingOriginal = false;
        currentEditorContent = null;

        // Update button
        if (btn) {
            btn.innerHTML = '<i class="fas fa-history"></i> View Original Code';
            btn.classList.remove('active');
        }

        // Remove banner
        hideOriginalBanner();
        appendClaudeOutput('↩ Back to current version', 'info');
    }
}

// Show banner when viewing original
function showOriginalBanner() {
    let banner = document.getElementById('original-view-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'original-view-banner';
        banner.className = 'original-view-banner';
        banner.innerHTML = `
            <span><i class="fas fa-history"></i> Viewing Original Code (Read-Only)</span>
            <button onclick="toggleViewOriginal()"><i class="fas fa-times"></i> Close</button>
        `;
        const editorArea = document.querySelector('.tex-editor-area');
        if (editorArea) {
            editorArea.insertBefore(banner, editorArea.firstChild);
        }
    }
    banner.classList.add('visible');
}

// Hide original view banner
function hideOriginalBanner() {
    const banner = document.getElementById('original-view-banner');
    if (banner) {
        banner.classList.remove('visible');
    }
}

// Show text diff modal with navigation
function showTextDiff() {
    if (!claudeEditBackup.originalContent || !texEditor) return;

    const oldContent = claudeEditBackup.originalContent;
    const newContent = isViewingOriginal ? currentEditorContent : texEditor.getValue();

    // Create diff modal
    let modal = document.getElementById('claude-diff-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'claude-diff-modal';
    modal.className = 'claude-diff-modal-overlay';

    // Compute diff with change tracking
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let diffHtml = '';
    diffChangeIndices = [];
    let lineIndex = 0;
    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];

        if (oldLine === newLine) {
            diffHtml += `<div class="diff-line same" data-index="${lineIndex}"><span class="line-num">${i + 1}</span><span class="line-content">${escapeHtml(oldLine || '')}</span></div>`;
            lineIndex++;
        } else {
            // Track this as a change
            diffChangeIndices.push(lineIndex);

            if (oldLine !== undefined && newLine !== undefined) {
                // Modified line
                diffHtml += `<div class="diff-line removed diff-change" data-index="${lineIndex}"><span class="line-num">-${i + 1}</span><span class="line-content">${escapeHtml(oldLine)}</span></div>`;
                lineIndex++;
                diffHtml += `<div class="diff-line added" data-index="${lineIndex}"><span class="line-num">+${i + 1}</span><span class="line-content">${escapeHtml(newLine)}</span></div>`;
                lineIndex++;
            } else if (oldLine === undefined) {
                // Added line
                diffHtml += `<div class="diff-line added diff-change" data-index="${lineIndex}"><span class="line-num">+${i + 1}</span><span class="line-content">${escapeHtml(newLine)}</span></div>`;
                lineIndex++;
            } else {
                // Removed line
                diffHtml += `<div class="diff-line removed diff-change" data-index="${lineIndex}"><span class="line-num">-${i + 1}</span><span class="line-content">${escapeHtml(oldLine)}</span></div>`;
                lineIndex++;
            }
        }
    }

    currentDiffIndex = 0;

    modal.innerHTML = `
        <div class="claude-diff-modal">
            <div class="claude-diff-header">
                <h3><i class="fas fa-code-compare"></i> Text Diff</h3>
                <div class="diff-nav">
                    <button class="diff-nav-btn" onclick="diffNavPrev()" title="Previous change (↑)">
                        <i class="fas fa-chevron-up"></i>
                    </button>
                    <span class="diff-nav-info" id="diff-nav-info">${diffChangeIndices.length} changes</span>
                    <button class="diff-nav-btn" onclick="diffNavNext()" title="Next change (↓)">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                <button class="claude-diff-close" onclick="closeTextDiff()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="claude-diff-content" id="diff-content">${diffHtml}</div>
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

    // Auto-scroll to first change
    setTimeout(() => {
        if (diffChangeIndices.length > 0) {
            scrollToChange(0);
        }
    }, 100);

    // Add keyboard navigation
    modal.addEventListener('keydown', handleDiffKeydown);
    modal.tabIndex = 0;
    modal.focus();
}

// Navigate to previous change
function diffNavPrev() {
    if (diffChangeIndices.length === 0) return;
    currentDiffIndex = (currentDiffIndex - 1 + diffChangeIndices.length) % diffChangeIndices.length;
    scrollToChange(currentDiffIndex);
}

// Navigate to next change
function diffNavNext() {
    if (diffChangeIndices.length === 0) return;
    currentDiffIndex = (currentDiffIndex + 1) % diffChangeIndices.length;
    scrollToChange(currentDiffIndex);
}

// Scroll to specific change
function scrollToChange(index) {
    const content = document.getElementById('diff-content');
    if (!content) return;

    // Remove previous highlight
    content.querySelectorAll('.diff-current').forEach(el => el.classList.remove('diff-current'));

    // Find and highlight the change
    const changes = content.querySelectorAll('.diff-change');
    if (changes[index]) {
        changes[index].classList.add('diff-current');
        changes[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Update nav info
    const info = document.getElementById('diff-nav-info');
    if (info) {
        info.textContent = `${index + 1} / ${diffChangeIndices.length} changes`;
    }
}

// Handle keyboard navigation in diff modal
function handleDiffKeydown(e) {
    if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        diffNavPrev();
    } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        diffNavNext();
    } else if (e.key === 'Escape') {
        closeTextDiff();
    }
}

// Close text diff modal
function closeTextDiff() {
    const modal = document.getElementById('claude-diff-modal');
    if (modal) {
        modal.removeEventListener('keydown', handleDiffKeydown);
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
    }
}

// ============================================================================
// VERSION HISTORY
// ============================================================================

// Show version history panel
async function showVersionHistory() {
    if (!currentTexFile.path) return;

    try {
        const response = await fetch(`/api/tex-history/${encodeURIComponent(currentTexFile.path)}`);
        const data = await response.json();

        if (!data.success) {
            showNotification('Could not load history', 3000);
            return;
        }

        // Create history modal
        let modal = document.getElementById('version-history-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'version-history-modal';
        modal.className = 'version-history-overlay';

        let historyHtml = '';
        if (data.versions.length === 0) {
            historyHtml = '<div class="history-empty"><i class="fas fa-inbox"></i><p>No backups yet</p></div>';
        } else {
            historyHtml = '<div class="history-list">';
            for (const version of data.versions) {
                const date = new Date(version.timestamp);
                const timeAgo = getTimeAgo(date);
                historyHtml += `
                    <div class="history-item" data-path="${escapeHtml(version.path)}">
                        <div class="history-item-info">
                            <span class="history-time">${timeAgo}</span>
                            <span class="history-date">${date.toLocaleString()}</span>
                        </div>
                        <div class="history-item-actions">
                            <button class="history-btn view" onclick="viewHistoryVersion('${escapeHtml(version.path)}')">
                                <i class="fas fa-eye"></i> View
                            </button>
                            <button class="history-btn restore" onclick="restoreHistoryVersion('${escapeHtml(version.path)}')">
                                <i class="fas fa-undo"></i> Restore
                            </button>
                        </div>
                    </div>
                `;
            }
            historyHtml += '</div>';
        }

        modal.innerHTML = `
            <div class="version-history-modal">
                <div class="history-header">
                    <h3><i class="fas fa-clock-rotate-left"></i> Version History</h3>
                    <button class="history-close" onclick="closeVersionHistory()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="history-content">${historyHtml}</div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.classList.add('visible');

    } catch (error) {
        showNotification('Error loading history: ' + error.message, 3000);
    }
}

// Get human-readable time ago
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
}

// View a history version
async function viewHistoryVersion(backupPath) {
    try {
        const response = await fetch(`/api/tex-content/${encodeURIComponent(backupPath)}`);
        const data = await response.json();

        if (data.success && texEditor) {
            // Save current if not already viewing
            if (!isViewingOriginal) {
                currentEditorContent = texEditor.getValue();
            }

            texEditor.setValue(data.content);
            texEditor.setOption('readOnly', true);
            isViewingOriginal = true;

            // Show banner
            const banner = document.getElementById('original-view-banner') || document.createElement('div');
            banner.id = 'original-view-banner';
            banner.className = 'original-view-banner visible';
            banner.innerHTML = `
                <span><i class="fas fa-history"></i> Viewing Backup: ${backupPath.split('/').pop()}</span>
                <button onclick="closeHistoryView()"><i class="fas fa-times"></i> Close</button>
            `;
            const editorArea = document.querySelector('.tex-editor-area');
            if (editorArea && !document.getElementById('original-view-banner')) {
                editorArea.insertBefore(banner, editorArea.firstChild);
            }

            closeVersionHistory();
        }
    } catch (error) {
        showNotification('Error loading version: ' + error.message, 3000);
    }
}

// Close history view and restore current content
function closeHistoryView() {
    if (texEditor && currentEditorContent) {
        texEditor.setValue(currentEditorContent);
        texEditor.setOption('readOnly', false);
    }
    isViewingOriginal = false;
    currentEditorContent = null;
    hideOriginalBanner();
}

// Restore a history version
async function restoreHistoryVersion(backupPath) {
    if (!confirm('Restore this version? Current changes will be backed up first.')) {
        return;
    }

    try {
        const response = await fetch('/api/tex-restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                texPath: currentTexFile.path,
                backupPath: backupPath
            })
        });

        const data = await response.json();

        if (data.success) {
            // Reload the file
            const contentResponse = await fetch(`/api/tex-content/${currentTexFile.path}`);
            const contentData = await contentResponse.json();

            if (contentData.success && texEditor) {
                texEditor.setValue(contentData.content);
                isTexModified = false;
                updateTexStatus('saved', 'Restored');
            }

            closeVersionHistory();
            showNotification('Version restored!', 3000);

            // Recompile
            await compileTexFile();
        } else {
            showNotification('Failed to restore: ' + data.error, 3000);
        }
    } catch (error) {
        showNotification('Error restoring version: ' + error.message, 3000);
    }
}

// Close version history modal
function closeVersionHistory() {
    const modal = document.getElementById('version-history-modal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
    }
}

// Keep Claude changes
async function keepClaudeChanges() {
    appendClaudeOutput('', 'info');
    appendClaudeOutput('✓ Changes kept!', 'success');
    appendClaudeOutput(`📁 Backup saved: ${claudeEditBackup.backupTexPath}`, 'info');

    // Refresh PDF to new version
    if (claudeEditBackup.newPdfPath) {
        refreshPdfPreview(claudeEditBackup.newPdfPath);
    }

    // Save the file
    await saveTexFile();

    // Clear backup data
    claudeEditBackup = {
        originalContent: null,
        originalPdfPath: null,
        backupTexPath: null,
        backupPdfPath: null,
        newPdfPath: null
    };

    resetClaudeState();
    showNotification('Changes saved successfully!', 3000);
}

// Revert Claude changes
async function revertClaudeChanges() {
    if (!claudeEditBackup.originalContent) {
        showNotification('No backup available to revert to', 3000);
        return;
    }

    appendClaudeOutput('', 'info');
    appendClaudeOutput('⚠ Reverting changes...', 'warning');

    // Restore editor content from in-memory backup (instant!)
    if (texEditor) {
        texEditor.setValue(claudeEditBackup.originalContent);
        isTexModified = true;
        updateTexStatus('modified', 'Reverted');
    }

    appendClaudeOutput('✓ Editor content restored', 'success');
    appendClaudeOutput('⚙ Saving and recompiling...', 'info');

    // Save the reverted content
    await saveTexFile();

    // Recompile to get original PDF back
    await compileTexFile();

    // Clear backup
    claudeEditBackup = {
        originalContent: null,
        originalPdfPath: null,
        backupTexPath: null,
        backupPdfPath: null,
        newPdfPath: null
    };

    resetClaudeState();
    appendClaudeOutput('✓ Reverted to original!', 'success');
    showNotification('Reverted to original version', 3000);
}

// Close dropdown when clicking outside
document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('claude-dropdown');
    const btn = document.getElementById('claude-edit-btn');

    if (dropdown && dropdown.classList.contains('visible')) {
        if (!dropdown.contains(event.target) && !btn.contains(event.target)) {
            dropdown.classList.remove('visible');
        }
    }
});

// ============================================================================
// VERSION CONTROL SYSTEM
// ============================================================================

// Initialize version control when opening a file
async function initializeVersionControl() {
    if (!currentTexFile.path) return;

    try {
        // Initialize version control for this file
        const initResponse = await fetch(`/api/tex-versions/${encodeURIComponent(currentTexFile.path)}/init`, {
            method: 'POST'
        });
        const initData = await initResponse.json();

        if (initData.success) {
            // Load versions
            await loadVersions();
            lastSavedContent = texEditor ? texEditor.getValue() : null;
        }
    } catch (error) {
        console.error('Error initializing version control:', error);
    }
}

// Load versions from server
async function loadVersions() {
    if (!currentTexFile.path) return;

    try {
        const response = await fetch(`/api/tex-versions/${encodeURIComponent(currentTexFile.path)}`);
        const data = await response.json();

        if (data.success) {
            texVersions = data.versions;
            updateVersionBadge();
            renderVersionList();
        }
    } catch (error) {
        console.error('Error loading versions:', error);
    }
}

// Update the version badge in toolbar
function updateVersionBadge() {
    const badge = document.getElementById('version-badge');
    const currentInfo = document.getElementById('current-version-info');

    if (!badge) return;

    const currentVersion = texVersions.find(v => v.isCurrent);
    if (currentVersion) {
        currentVersionNumber = currentVersion.versionNumber;
        badge.textContent = `v${currentVersion.versionNumber}`;
        badge.className = `version-badge ${currentVersion.source}`;

        if (currentInfo) {
            const sourceClass = currentVersion.source === 'claude' ? 'claude' : 'user';
            const sourceLabel = currentVersion.source === 'claude' ? 'Claude' : 'User';
            currentInfo.innerHTML = `
                <span class="version-number">v${currentVersion.versionNumber}</span>
                <span class="version-source ${sourceClass}">${sourceLabel}</span>
                ${currentVersion.summary ? `<span class="version-summary">${escapeHtml(currentVersion.summary)}</span>` : ''}
            `;
        }
    } else if (texVersions.length > 0) {
        const latest = texVersions[0];
        currentVersionNumber = latest.versionNumber;
        badge.textContent = `v${latest.versionNumber}`;
        badge.className = `version-badge ${latest.source}`;

        if (currentInfo) {
            const sourceClass = latest.source === 'claude' ? 'claude' : 'user';
            const sourceLabel = latest.source === 'claude' ? 'Claude' : 'User';
            currentInfo.innerHTML = `
                <span class="version-number">v${latest.versionNumber}</span>
                <span class="version-source ${sourceClass}">${sourceLabel}</span>
                ${latest.summary ? `<span class="version-summary">${escapeHtml(latest.summary)}</span>` : ''}
            `;
        }
    } else {
        badge.textContent = 'v1';
        badge.className = 'version-badge user';
        currentVersionNumber = 1;

        if (currentInfo) {
            currentInfo.innerHTML = `
                <span class="version-number">v1</span>
                <span class="version-source user">User</span>
            `;
        }
    }
}

// Render the version list in the panel
function renderVersionList() {
    const listEl = document.getElementById('version-panel-list');
    if (!listEl) return;

    if (texVersions.length === 0) {
        listEl.innerHTML = `
            <div class="version-empty">
                <i class="fas fa-inbox"></i>
                <p>No versions yet</p>
                <p class="hint">Versions are created when you save or Claude edits</p>
            </div>
        `;
        return;
    }

    let html = '';
    texVersions.forEach((version, index) => {
        const date = new Date(version.createdAt);
        const timeAgo = getTimeAgo(date);
        const isCurrentClass = version.isCurrent ? 'current' : '';
        const sourceClass = version.source === 'claude' ? 'claude' : 'user';
        const sourceIcon = version.source === 'claude' ? 'fa-magic' : 'fa-user';
        const sourceLabel = version.source === 'claude' ? 'Claude' : 'User';

        html += `
            <div class="version-item ${isCurrentClass}" data-version="${version.versionNumber}">
                <div class="version-item-header">
                    <span class="version-item-number">v${version.versionNumber}</span>
                    <span class="version-item-source ${sourceClass}">
                        <i class="fas ${sourceIcon}"></i> ${sourceLabel}
                    </span>
                    ${version.isCurrent ? '<span class="version-current-badge">Current</span>' : ''}
                </div>
                <div class="version-item-summary">
                    ${version.summary ? escapeHtml(version.summary) : '<em>No summary</em>'}
                </div>
                <div class="version-item-time">
                    <i class="fas fa-clock"></i> ${timeAgo}
                    <span class="version-item-date">${date.toLocaleString()}</span>
                </div>
                <div class="version-item-actions">
                    <button class="version-item-btn view" onclick="viewVersion(${version.versionNumber})" title="Preview this version">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${!version.isCurrent ? `
                        <button class="version-item-btn restore" onclick="switchToVersion(${version.versionNumber})" title="Switch to this version">
                            <i class="fas fa-undo"></i> Use
                        </button>
                    ` : ''}
                    ${index > 0 ? `
                        <button class="version-item-btn diff" onclick="compareVersions(${version.versionNumber}, ${texVersions[index - 1].versionNumber})" title="Compare with previous">
                            <i class="fas fa-code-compare"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

// Toggle version panel visibility
function toggleVersionPanel() {
    const panel = document.getElementById('version-control-panel');
    const btn = document.getElementById('version-toggle-btn');

    if (panel) {
        isVersionPanelOpen = !isVersionPanelOpen;
        panel.classList.toggle('open', isVersionPanelOpen);

        if (btn) {
            btn.classList.toggle('active', isVersionPanelOpen);
        }

        // Refresh versions when opening
        if (isVersionPanelOpen) {
            loadVersions();
        }
    }
}

// Save a new version manually
async function saveVersionManually() {
    if (!texEditor || !currentTexFile.path) return;

    // Prompt for summary
    const summary = prompt('Enter a brief summary for this version (optional):');

    const content = texEditor.getValue();

    try {
        const response = await fetch(`/api/tex-versions/${encodeURIComponent(currentTexFile.path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                summary: summary || 'Manual save',
                source: 'user'
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Version v${data.versionNumber} saved!`, 3000);
            lastSavedContent = content;
            await loadVersions();

            // Highlight the new version in the list
            setTimeout(() => {
                const newVersionEl = document.querySelector(`.version-item[data-version="${data.versionNumber}"]`);
                if (newVersionEl) {
                    newVersionEl.classList.add('highlight-user');
                    newVersionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => newVersionEl.classList.remove('highlight-user'), 2000);
                }
            }, 100);
        } else {
            showNotification('Failed to save version: ' + data.error, 5000);
        }
    } catch (error) {
        showNotification('Error saving version: ' + error.message, 5000);
    }
}

// Auto-save version when significant changes are made
function scheduleVersionSave() {
    if (!texEditor || !currentTexFile.path) return;

    clearTimeout(versionSaveTimeout);

    versionSaveTimeout = setTimeout(async () => {
        const currentContent = texEditor.getValue();

        // Only save if content has changed significantly from last version
        if (lastSavedContent && currentContent !== lastSavedContent) {
            const changeRatio = Math.abs(currentContent.length - lastSavedContent.length) / Math.max(lastSavedContent.length, 1);

            // Save version if >5% change or >100 characters difference
            if (changeRatio > 0.05 || Math.abs(currentContent.length - lastSavedContent.length) > 100) {
                await saveVersionSilently(currentContent, 'Auto-saved changes');
            }
        }
    }, VERSION_SAVE_DELAY);
}

// Save version silently (without notification)
async function saveVersionSilently(content, summary) {
    if (!currentTexFile.path) return;

    try {
        const response = await fetch(`/api/tex-versions/${encodeURIComponent(currentTexFile.path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                summary,
                source: 'user'
            })
        });

        const data = await response.json();

        if (data.success) {
            lastSavedContent = content;
            await loadVersions();
        }
    } catch (error) {
        console.error('Error auto-saving version:', error);
    }
}

// Save version after Claude edit
async function saveClaudeVersion(content, action, customPrompt) {
    if (!currentTexFile.path) return;

    let summary = '';
    switch (action) {
        case 'improve':
            summary = 'Claude: Improved clarity and readability';
            break;
        case 'fix':
            summary = 'Claude: Fixed errors and typos';
            break;
        case 'simplify':
            summary = 'Claude: Simplified content';
            break;
        case 'expand':
            summary = 'Claude: Expanded and elaborated';
            break;
        case 'symbols':
            summary = 'Claude: Added proper LaTeX symbols';
            break;
        case 'custom':
            summary = `Claude: ${customPrompt.substring(0, 50)}${customPrompt.length > 50 ? '...' : ''}`;
            break;
        default:
            summary = `Claude: ${action}`;
    }

    try {
        const response = await fetch(`/api/tex-versions/${encodeURIComponent(currentTexFile.path)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                summary,
                source: 'claude'
            })
        });

        const data = await response.json();

        if (data.success) {
            lastSavedContent = content;
            await loadVersions();

            // Open version panel to show the new Claude version
            if (!isVersionPanelOpen) {
                toggleVersionPanel();
            }

            // Show notification about new version
            showNotification(`Claude created version v${data.versionNumber}`, 3000);

            // Highlight the new version in the list
            setTimeout(() => {
                const newVersionEl = document.querySelector(`.version-item[data-version="${data.versionNumber}"]`);
                if (newVersionEl) {
                    newVersionEl.classList.add('highlight-new');
                    newVersionEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    setTimeout(() => newVersionEl.classList.remove('highlight-new'), 2000);
                }
            }, 100);
        }
    } catch (error) {
        console.error('Error saving Claude version:', error);
    }
}

// View a specific version (preview mode)
async function viewVersion(versionNumber) {
    if (!currentTexFile.path) return;

    try {
        const response = await fetch(`/api/tex-version/${encodeURIComponent(currentTexFile.path)}/v/${versionNumber}`);
        const data = await response.json();

        if (data.success && texEditor) {
            // Save current content if not already viewing
            if (!isViewingOriginal) {
                currentEditorContent = texEditor.getValue();
            }

            texEditor.setValue(data.content);
            texEditor.setOption('readOnly', true);
            isViewingOriginal = true;

            // Show version preview banner
            showVersionPreviewBanner(versionNumber, data.summary, data.source);
        }
    } catch (error) {
        showNotification('Error loading version: ' + error.message, 3000);
    }
}

// Show banner when viewing a version
function showVersionPreviewBanner(versionNumber, summary, source) {
    let banner = document.getElementById('version-preview-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'version-preview-banner';
        banner.className = 'version-preview-banner';
        const editorArea = document.querySelector('.tex-editor-area');
        if (editorArea) {
            editorArea.insertBefore(banner, editorArea.firstChild);
        }
    }

    const sourceIcon = source === 'claude' ? 'fa-magic' : 'fa-user';
    const sourceLabel = source === 'claude' ? 'Claude' : 'User';

    banner.innerHTML = `
        <span>
            <i class="fas fa-eye"></i> Viewing v${versionNumber}
            <span class="preview-source ${source}"><i class="fas ${sourceIcon}"></i> ${sourceLabel}</span>
            ${summary ? `<span class="preview-summary">${escapeHtml(summary)}</span>` : ''}
        </span>
        <div class="preview-actions">
            <button onclick="switchToVersion(${versionNumber})"><i class="fas fa-check"></i> Use This Version</button>
            <button onclick="closeVersionPreview()"><i class="fas fa-times"></i> Close</button>
        </div>
    `;
    banner.classList.add('visible');
}

// Close version preview and restore current content
function closeVersionPreview() {
    if (texEditor && currentEditorContent) {
        texEditor.setValue(currentEditorContent);
        texEditor.setOption('readOnly', false);
    }
    isViewingOriginal = false;
    currentEditorContent = null;

    const banner = document.getElementById('version-preview-banner');
    if (banner) {
        banner.classList.remove('visible');
    }
}

// Switch to a specific version (creates new version from old content)
async function switchToVersion(versionNumber) {
    if (!currentTexFile.path || !texEditor) return;

    // Get content from preview if we're viewing it, otherwise we'll get from API
    const previewContent = isViewingOriginal ? texEditor.getValue() : null;

    // Close preview banner if open
    if (isViewingOriginal) {
        const banner = document.getElementById('version-preview-banner');
        if (banner) banner.classList.remove('visible');
        isViewingOriginal = false;
        currentEditorContent = null;
    }

    // Show immediate feedback
    showNotification(`Switching to version ${versionNumber}...`, 2000);
    updateTexStatus('saving', 'Switching version...');

    try {
        const response = await fetch(`/api/tex-versions/${encodeURIComponent(currentTexFile.path)}/switch/${versionNumber}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (data.success) {
            // Use content from API response, or fall back to preview content if available
            const content = data.content || previewContent;

            if (content) {
                texEditor.setValue(content);
            }
            texEditor.setOption('readOnly', false);
            isTexModified = true;
            lastSavedContent = content || texEditor.getValue();

            updateTexStatus('modified', `Switched to v${versionNumber}`);
            showNotification(`Switched to version ${versionNumber}`, 3000);

            // Save to file and recompile
            await saveTexFile();
            await compileTexFile();

            // Reload versions
            await loadVersions();
        } else {
            showNotification('Failed to switch version: ' + (data.error || 'Unknown error'), 5000);
            updateTexStatus('saved', '');
        }
    } catch (error) {
        showNotification('Error switching version: ' + error.message, 5000);
        updateTexStatus('saved', '');
    }
}

// Compare two versions
async function compareVersions(v1, v2) {
    if (!currentTexFile.path) return;

    try {
        const response = await fetch(`/api/tex-versions/${encodeURIComponent(currentTexFile.path)}/compare/${v1}/${v2}`);
        const data = await response.json();

        if (data.success) {
            showVersionDiffModal(data.version1, data.version2);
        } else {
            showNotification('Failed to compare versions', 3000);
        }
    } catch (error) {
        showNotification('Error comparing versions: ' + error.message, 3000);
    }
}

// Show version diff modal
function showVersionDiffModal(v1, v2) {
    // Remove existing modal
    let modal = document.getElementById('version-diff-modal');
    if (modal) modal.remove();

    const oldLines = v1.content.split('\n');
    const newLines = v2.content.split('\n');

    let diffHtml = '';
    diffChangeIndices = [];
    let lineIndex = 0;
    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];

        if (oldLine === newLine) {
            diffHtml += `<div class="diff-line same" data-index="${lineIndex}"><span class="line-num">${i + 1}</span><span class="line-content">${escapeHtml(oldLine || '')}</span></div>`;
            lineIndex++;
        } else {
            diffChangeIndices.push(lineIndex);

            if (oldLine !== undefined && newLine !== undefined) {
                diffHtml += `<div class="diff-line removed diff-change" data-index="${lineIndex}"><span class="line-num">-${i + 1}</span><span class="line-content">${escapeHtml(oldLine)}</span></div>`;
                lineIndex++;
                diffHtml += `<div class="diff-line added" data-index="${lineIndex}"><span class="line-num">+${i + 1}</span><span class="line-content">${escapeHtml(newLine)}</span></div>`;
                lineIndex++;
            } else if (oldLine === undefined) {
                diffHtml += `<div class="diff-line added diff-change" data-index="${lineIndex}"><span class="line-num">+${i + 1}</span><span class="line-content">${escapeHtml(newLine)}</span></div>`;
                lineIndex++;
            } else {
                diffHtml += `<div class="diff-line removed diff-change" data-index="${lineIndex}"><span class="line-num">-${i + 1}</span><span class="line-content">${escapeHtml(oldLine)}</span></div>`;
                lineIndex++;
            }
        }
    }

    currentDiffIndex = 0;

    const v1Source = v1.source === 'claude' ? 'Claude' : 'User';
    const v2Source = v2.source === 'claude' ? 'Claude' : 'User';

    modal = document.createElement('div');
    modal.id = 'version-diff-modal';
    modal.className = 'claude-diff-modal-overlay visible';
    modal.innerHTML = `
        <div class="claude-diff-modal">
            <div class="claude-diff-header">
                <h3><i class="fas fa-code-compare"></i> Compare v${v1.number} vs v${v2.number}</h3>
                <div class="diff-version-labels">
                    <span class="diff-label old">v${v1.number} (${v1Source})</span>
                    <i class="fas fa-arrow-right"></i>
                    <span class="diff-label new">v${v2.number} (${v2Source})</span>
                </div>
                <div class="diff-nav">
                    <button class="diff-nav-btn" onclick="diffNavPrev()" title="Previous change (↑)">
                        <i class="fas fa-chevron-up"></i>
                    </button>
                    <span class="diff-nav-info" id="diff-nav-info">${diffChangeIndices.length} changes</span>
                    <button class="diff-nav-btn" onclick="diffNavNext()" title="Next change (↓)">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                <button class="claude-diff-close" onclick="closeVersionDiffModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="claude-diff-content" id="diff-content">${diffHtml}</div>
            <div class="claude-diff-footer">
                <span class="diff-legend">
                    <span class="legend-removed">- Removed</span>
                    <span class="legend-added">+ Added</span>
                </span>
                <button class="claude-diff-btn" onclick="closeVersionDiffModal()">Close</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Auto-scroll to first change
    setTimeout(() => {
        if (diffChangeIndices.length > 0) {
            scrollToChange(0);
        }
    }, 100);

    // Add keyboard navigation
    modal.addEventListener('keydown', handleDiffKeydown);
    modal.tabIndex = 0;
    modal.focus();
}

// Close version diff modal
function closeVersionDiffModal() {
    const modal = document.getElementById('version-diff-modal');
    if (modal) {
        modal.removeEventListener('keydown', handleDiffKeydown);
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
    }
}

// Helper function to get time ago string
function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;

    return date.toLocaleDateString();
}

// Keyboard shortcut for version panel (Cmd/Ctrl+Shift+V)
document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'v') {
        e.preventDefault();
        toggleVersionPanel();
    }
});

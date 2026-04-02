// ============================================================================
// FILE MANAGER - COPY/PASTE & DRAG & DROP
// ============================================================================

let clipboard = null;
// Use existing selectedFiles if already declared in script.js, otherwise create new
if (typeof selectedFiles === 'undefined') {
    var selectedFiles = new Set();
}
let draggedElement = null;

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    initFileSelection();
    initKeyboardShortcuts();
    initDragAndDrop();
    initContextMenu();
    displaySelectionToolbar();
});

// ============================================================================
// FILE SELECTION
// ============================================================================

function initFileSelection() {
    // Allow multi-select with Ctrl/Cmd + Click
    document.addEventListener('click', function(e) {
        const fileRow = e.target.closest('tr[data-file-path]');

        if (fileRow) {
            if (e.ctrlKey || e.metaKey) {
                // Multi-select
                toggleFileSelection(fileRow);
            } else if (e.shiftKey && selectedFiles.size > 0) {
                // Range select
                selectFileRange(fileRow);
            } else {
                // Single select
                clearSelection();
                selectFile(fileRow);
            }
            updateSelectionToolbar();
        } else if (!e.target.closest('.selection-toolbar') && !e.target.closest('.context-menu')) {
            clearSelection();
            updateSelectionToolbar();
        }
    });
}

function selectFile(fileRow) {
    const filePath = fileRow.dataset.filePath;
    selectedFiles.add(filePath);
    fileRow.classList.add('file-selected');
}

function toggleFileSelection(fileRow) {
    const filePath = fileRow.dataset.filePath;

    if (selectedFiles.has(filePath)) {
        selectedFiles.delete(filePath);
        fileRow.classList.remove('file-selected');
    } else {
        selectedFiles.add(filePath);
        fileRow.classList.add('file-selected');
    }
}

function selectFileRange(endRow) {
    const allRows = Array.from(document.querySelectorAll('tr[data-file-path]'));
    const lastSelected = Array.from(selectedFiles)[selectedFiles.size - 1];
    const lastRow = document.querySelector(`tr[data-file-path="${lastSelected}"]`);

    if (!lastRow) return;

    const startIndex = allRows.indexOf(lastRow);
    const endIndex = allRows.indexOf(endRow);
    const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];

    for (let i = from; i <= to; i++) {
        selectFile(allRows[i]);
    }
}

function clearSelection() {
    selectedFiles.clear();
    document.querySelectorAll('.file-selected').forEach(row => {
        row.classList.remove('file-selected');
    });
}

function selectAll() {
    clearSelection();
    document.querySelectorAll('tr[data-file-path]').forEach(row => {
        selectFile(row);
    });
    updateSelectionToolbar();
}

// ============================================================================
// CLIPBOARD OPERATIONS (Copy/Paste)
// ============================================================================

function copyFiles() {
    if (selectedFiles.size === 0) return;

    clipboard = {
        operation: 'copy',
        files: Array.from(selectedFiles),
        timestamp: Date.now()
    };

    showNotification(`Copied ${selectedFiles.size} file(s)`, 'success');
    updateSelectionToolbar();
}

function cutFiles() {
    if (selectedFiles.size === 0) return;

    clipboard = {
        operation: 'cut',
        files: Array.from(selectedFiles),
        timestamp: Date.now()
    };

    // Visual indication of cut files
    selectedFiles.forEach(path => {
        const row = document.querySelector(`tr[data-file-path="${path}"]`);
        if (row) row.classList.add('file-cut');
    });

    showNotification(`Cut ${selectedFiles.size} file(s)`, 'success');
    updateSelectionToolbar();
}

async function pasteFiles(targetCategory = null) {
    if (!clipboard || clipboard.files.length === 0) {
        showNotification('Nothing to paste', 'info');
        return;
    }

    const operation = clipboard.operation === 'copy' ? 'copy' : 'move';
    const files = clipboard.files;

    // If no target category specified, try to get current category from view
    if (!targetCategory) {
        // Default to current view if available
        const currentView = getCurrentCategory();
        if (currentView && currentView !== 'all') {
            targetCategory = currentView;
        } else {
            showNotification('Please select a target category from sidebar or breadcrumb', 'warning');
            return;
        }
    }

    showNotification(`${operation === 'copy' ? 'Copying' : 'Moving'} ${files.length} file(s)...`, 'info');

    try {
        const response = await fetch('/api/file-manager/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, targetCategory, operation })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');

            // Clear cut styling
            if (operation === 'move') {
                document.querySelectorAll('.file-cut').forEach(row => {
                    row.classList.remove('file-cut');
                });
                clipboard = null;
            }

            // Reload file list
            setTimeout(() => {
                window.location.reload();
            }, 1000);

        } else {
            showNotification(data.error || 'Operation failed', 'error');
            if (data.errors && data.errors.length > 0) {
                console.error('File operation errors:', data.errors);
            }
        }

    } catch (error) {
        console.error('Paste error:', error);
        showNotification('Failed to paste files', 'error');
    }
}

async function deleteSelectedFiles() {
    if (selectedFiles.size === 0) return;

    const count = selectedFiles.size;
    const files = Array.from(selectedFiles);

    const confirmation = confirm(`⚠️ Delete ${count} file(s)?\n\nThis action cannot be undone!\n\nFiles will be permanently deleted from disk.`);

    if (!confirmation) return;

    showNotification(`Deleting ${count} file(s)...`, 'info');

    try {
        const response = await fetch('/api/file-manager/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');

            clearSelection();
            updateSelectionToolbar();

            // Reload file list
            setTimeout(() => {
                window.location.reload();
            }, 1000);

        } else {
            showNotification(data.error || 'Delete failed', 'error');
            if (data.errors && data.errors.length > 0) {
                console.error('Delete errors:', data.errors);
            }
        }

    } catch (error) {
        console.error('Delete error:', error);
        showNotification('Failed to delete files', 'error');
    }
}

// ============================================================================
// KEYBOARD SHORTCUTS
// ============================================================================

function initKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        // Don't trigger shortcuts if typing in input/textarea
        const isTyping = e.target.matches('input, textarea');

        // Ctrl/Cmd + A - Select All
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            selectAll();
        }

        // Ctrl/Cmd + C - Copy
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedFiles.size > 0 && !isTyping) {
            e.preventDefault();
            copyFiles();
        }

        // Ctrl/Cmd + X - Cut
        if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selectedFiles.size > 0 && !isTyping) {
            e.preventDefault();
            cutFiles();
        }

        // Ctrl/Cmd + V - Paste
        if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard && !isTyping) {
            e.preventDefault();
            pasteFiles();
        }

        // Delete/Backspace - Delete
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFiles.size > 0 && !isTyping) {
            e.preventDefault();
            deleteSelectedFiles();
        }

        // F2 or Enter - Rename (like Finder/Windows Explorer)
        if ((e.key === 'F2' || (e.key === 'Enter' && selectedFiles.size === 1)) && !isTyping) {
            e.preventDefault();
            renameFile();
        }

        // Ctrl/Cmd + N - New/Upload
        if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
            e.preventDefault();
            window.location.href = '/upload.html';
        }

        // Ctrl/Cmd + O - Open selected file
        if ((e.ctrlKey || e.metaKey) && e.key === 'o' && selectedFiles.size === 1) {
            e.preventDefault();
            openSelectedFile();
        }

        // Escape - Clear selection
        if (e.key === 'Escape') {
            clearSelection();
            updateSelectionToolbar();
        }

        // Arrow keys for navigation
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !isTyping) {
            e.preventDefault();
            navigateWithArrows(e.key);
        }
    });
}

function navigateWithArrows(key) {
    const allRows = Array.from(document.querySelectorAll('tr[data-file-path]'));
    if (allRows.length === 0) return;

    let currentIndex = -1;
    if (selectedFiles.size === 1) {
        const selectedPath = Array.from(selectedFiles)[0];
        currentIndex = allRows.findIndex(row => row.dataset.filePath === selectedPath);
    }

    let newIndex = currentIndex;

    if (key === 'ArrowDown') {
        newIndex = Math.min(currentIndex + 1, allRows.length - 1);
    } else if (key === 'ArrowUp') {
        newIndex = Math.max(currentIndex - 1, 0);
    }

    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < allRows.length) {
        clearSelection();
        selectFile(allRows[newIndex]);
        updateSelectionToolbar();

        // Scroll into view
        allRows[newIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// ============================================================================
// DRAG AND DROP
// ============================================================================

function initDragAndDrop() {
    document.addEventListener('dragstart', function(e) {
        const fileRow = e.target.closest('tr[data-file-path]');

        if (fileRow) {
            draggedElement = fileRow;

            // If dragged file is not selected, select only it
            if (!selectedFiles.has(fileRow.dataset.filePath)) {
                clearSelection();
                selectFile(fileRow);
            }

            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', Array.from(selectedFiles).join(','));

            // Visual feedback
            setTimeout(() => {
                selectedFiles.forEach(path => {
                    const row = document.querySelector(`tr[data-file-path="${path}"]`);
                    if (row) row.classList.add('dragging');
                });
            }, 0);
        }
    });

    document.addEventListener('dragend', function(e) {
        document.querySelectorAll('.dragging').forEach(row => {
            row.classList.remove('dragging');
        });
        document.querySelectorAll('.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    });

    // Make sidebar categories drop targets
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.classList.add('drag-over');
        });

        item.addEventListener('dragleave', function(e) {
            this.classList.remove('drag-over');
        });

        item.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over');

            const category = this.getAttribute('onclick')?.match(/filterByCategory\('(.+?)'\)/)?.[1];

            if (category && category !== 'all') {
                moveFilesToCategory(category);
            }
        });
    });
}

// ============================================================================
// CONTEXT MENU (Right-Click)
// ============================================================================

function initContextMenu() {
    let contextMenu = null;

    document.addEventListener('contextmenu', function(e) {
        const fileRow = e.target.closest('tr[data-file-path]');
        const isInFileList = e.target.closest('.file-list-container, .file-list, #file-list-body, tbody');

        if (fileRow) {
            e.preventDefault();

            // Select file if not already selected
            if (!selectedFiles.has(fileRow.dataset.filePath)) {
                clearSelection();
                selectFile(fileRow);
                updateSelectionToolbar();
            }

            // Remove existing menu
            if (contextMenu) contextMenu.remove();

            // Create context menu for file
            contextMenu = createContextMenu(e.pageX, e.pageY);
            document.body.appendChild(contextMenu);

        } else if (isInFileList) {
            // Right-click on empty space in file list
            e.preventDefault();

            // Remove existing menu
            if (contextMenu) contextMenu.remove();

            // Create context menu for empty space
            contextMenu = createEmptySpaceContextMenu(e.pageX, e.pageY);
            document.body.appendChild(contextMenu);
        }
    });

    // Close context menu on click outside
    document.addEventListener('click', function(e) {
        if (contextMenu && !e.target.closest('.context-menu')) {
            contextMenu.remove();
            contextMenu = null;
        }
    });

    // Close on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    });
}

function createContextMenu(x, y) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const actions = [
        { icon: 'fa-folder-open', label: 'Open', action: () => openSelectedFile(), disabled: selectedFiles.size !== 1 },
        { divider: true },
        { icon: 'fa-copy', label: 'Copy', shortcut: 'Ctrl+C', action: copyFiles },
        { icon: 'fa-cut', label: 'Cut', shortcut: 'Ctrl+X', action: cutFiles },
        { icon: 'fa-paste', label: 'Paste', shortcut: 'Ctrl+V', action: pasteFiles, disabled: !clipboard },
        { divider: true },
        { icon: 'fa-edit', label: 'Rename', action: () => renameFile(), disabled: selectedFiles.size !== 1 },
        { icon: 'fa-trash', label: 'Delete', shortcut: 'Del', action: deleteSelectedFiles, danger: true }
    ];

    actions.forEach(action => {
        if (action.divider) {
            const divider = document.createElement('div');
            divider.className = 'context-menu-divider';
            menu.appendChild(divider);
        } else {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            if (action.disabled) item.classList.add('disabled');
            if (action.danger) item.classList.add('danger');

            item.innerHTML = `
                <i class="fas ${action.icon}"></i>
                <span>${action.label}</span>
                ${action.shortcut ? `<span class="shortcut">${action.shortcut}</span>` : ''}
            `;

            if (!action.disabled) {
                item.onclick = () => {
                    action.action();
                    menu.remove();
                };
            }

            menu.appendChild(item);
        }
    });

    return menu;
}

function openSelectedFile() {
    if (selectedFiles.size === 1) {
        const path = Array.from(selectedFiles)[0];
        const row = document.querySelector(`tr[data-file-path="${path}"]`);
        if (row) {
            // Trigger the row's onclick
            row.click();
        }
    }
}

function createEmptySpaceContextMenu(x, y) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const actions = [
        { icon: 'fa-upload', label: 'Upload PDF...', shortcut: 'Ctrl+N', action: () => window.location.href = '/upload.html' },
        { icon: 'fa-paste', label: 'Paste', shortcut: 'Ctrl+V', action: pasteFiles, disabled: !clipboard },
        { divider: true },
        { icon: 'fa-check-double', label: 'Select All', shortcut: 'Ctrl+A', action: selectAll },
        { icon: 'fa-sync', label: 'Refresh', shortcut: 'F5', action: () => window.location.reload() }
    ];

    actions.forEach(action => {
        if (action.divider) {
            const divider = document.createElement('div');
            divider.className = 'context-menu-divider';
            menu.appendChild(divider);
        } else {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            if (action.disabled) item.classList.add('disabled');

            item.innerHTML = `
                <i class="fas ${action.icon}"></i>
                <span>${action.label}</span>
                ${action.shortcut ? `<span class="shortcut">${action.shortcut}</span>` : ''}
            `;

            if (!action.disabled) {
                item.onclick = () => {
                    action.action();
                    menu.remove();
                };
            }

            menu.appendChild(item);
        }
    });

    return menu;
}

// ============================================================================
// SELECTION TOOLBAR
// ============================================================================

function displaySelectionToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = 'selection-toolbar';
    toolbar.className = 'selection-toolbar';
    toolbar.style.display = 'none';

    toolbar.innerHTML = `
        <div class="selection-toolbar-content">
            <span class="selection-count">0 selected</span>
            <div class="selection-actions">
                <button class="selection-btn" onclick="copyFiles()" title="Copy (Ctrl+C)">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="selection-btn" onclick="cutFiles()" title="Cut (Ctrl+X)">
                    <i class="fas fa-cut"></i>
                </button>
                <button class="selection-btn" onclick="pasteFiles()" title="Paste (Ctrl+V)" id="paste-btn" disabled>
                    <i class="fas fa-paste"></i>
                </button>
                <div class="selection-divider"></div>
                <button class="selection-btn" onclick="selectAll()" title="Select All (Ctrl+A)">
                    <i class="fas fa-check-double"></i>
                </button>
                <button class="selection-btn danger" onclick="deleteSelectedFiles()" title="Delete (Del)">
                    <i class="fas fa-trash"></i>
                </button>
                <button class="selection-btn" onclick="clearSelection(); updateSelectionToolbar();" title="Clear Selection (Esc)">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(toolbar);
}

function updateSelectionToolbar() {
    const toolbar = document.getElementById('selection-toolbar');
    if (!toolbar) return;

    const count = selectedFiles.size;
    const countEl = toolbar.querySelector('.selection-count');
    const pasteBtn = toolbar.querySelector('#paste-btn');

    if (count > 0) {
        toolbar.style.display = 'flex';
        countEl.textContent = `${count} selected`;
    } else {
        toolbar.style.display = 'none';
    }

    if (pasteBtn) {
        pasteBtn.disabled = !clipboard || clipboard.files.length === 0;
    }
}

// ============================================================================
// NOTIFICATIONS
// ============================================================================

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `file-manager-notification ${type}`;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle',
        warning: 'fa-exclamation-triangle'
    };

    notification.innerHTML = `
        <i class="fas ${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 2500);
}

// ============================================================================
// MAKE FILE ROWS DRAGGABLE
// ============================================================================

// Observe when file list is updated and add draggable attribute
const observer = new MutationObserver(function() {
    document.querySelectorAll('tr[data-file-path]').forEach(row => {
        if (!row.hasAttribute('draggable')) {
            row.setAttribute('draggable', 'true');
        }
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// ============================================================================
// RENAME FILE
// ============================================================================

let renameFilePath = null;

function renameFile() {
    if (selectedFiles.size !== 1) return;

    const filePath = Array.from(selectedFiles)[0];
    const fileName = filePath.split('/').pop();
    const currentName = fileName.replace('.pdf', '');

    // Store the file path for later use
    renameFilePath = filePath;

    // Open modal
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');

    modal.classList.add('show');
    input.value = currentName;

    // Focus input and select all text
    setTimeout(() => {
        input.focus();
        input.select();
    }, 100);

    // Handle Enter key
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitRename();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeRenameModal();
        }
    };
}

function closeRenameModal() {
    const modal = document.getElementById('rename-modal');
    modal.classList.remove('show');
    renameFilePath = null;
}

async function submitRename() {
    const input = document.getElementById('rename-input');
    const newName = input.value.trim();

    if (!newName || !renameFilePath) {
        closeRenameModal();
        return;
    }

    const filePath = renameFilePath;
    const fileName = filePath.split('/').pop();
    const currentName = fileName.replace('.pdf', '');

    if (newName === currentName) {
        closeRenameModal();
        return;
    }

    // Close modal first
    closeRenameModal();

    try {
        const response = await fetch('/api/file-manager/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldPath: filePath, newName })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');

            clearSelection();
            updateSelectionToolbar();

            // Reload file list
            setTimeout(() => {
                window.location.reload();
            }, 1000);

        } else {
            showNotification(data.error || 'Rename failed', 'error');
        }

    } catch (error) {
        console.error('Rename error:', error);
        showNotification('Failed to rename file', 'error');
    }
}

// ============================================================================
// MOVE FILES TO CATEGORY (FROM DRAG & DROP)
// ============================================================================

async function moveFilesToCategory(targetCategory) {
    if (selectedFiles.size === 0) return;

    const files = Array.from(selectedFiles);

    showNotification(`Moving ${files.length} file(s) to ${targetCategory}...`, 'info');

    try {
        const response = await fetch('/api/file-manager/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, targetCategory, operation: 'move' })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message, 'success');

            clearSelection();
            updateSelectionToolbar();

            // Reload file list
            setTimeout(() => {
                window.location.reload();
            }, 1000);

        } else {
            showNotification(data.error || 'Move failed', 'error');
            if (data.errors && data.errors.length > 0) {
                console.error('Move errors:', data.errors);
            }
        }

    } catch (error) {
        console.error('Move error:', error);
        showNotification('Failed to move files', 'error');
    }
}

// ============================================================================
// HELPER: GET CURRENT CATEGORY
// ============================================================================

function getCurrentCategory() {
    // Try to get from breadcrumb
    const locationText = document.getElementById('current-location')?.textContent;
    const categoryMap = {
        'All Files': 'all',
        'Lecture Notes': 'notes',
        'Lecture Slides': 'slides',
        'Exercises': 'exercises',
        'Exercises (No Solutions)': 'exercises-no-solutions',
        'Blueprint': 'blueprint',
        'Teachers Method': 'teachers-method'
    };

    return categoryMap[locationText] || 'all';
}

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

window.copyFiles = copyFiles;
window.cutFiles = cutFiles;
window.pasteFiles = pasteFiles;
window.deleteSelectedFiles = deleteSelectedFiles;
window.selectAll = selectAll;
window.clearSelection = clearSelection;
window.updateSelectionToolbar = updateSelectionToolbar;
window.renameFile = renameFile;
window.closeRenameModal = closeRenameModal;
window.submitRename = submitRename;

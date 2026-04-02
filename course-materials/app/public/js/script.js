// PDF structure - will be loaded dynamically from the server
let pdfStructure = {
    notes: {},
    slides: [],
    exercises: [],
    exercisesNoSolutions: [],
    blueprint: [],
    teachersMethod: [],
    lectures: []
};

let currentLeftPDF = { title: '', path: '', category: '' };
let currentRightPDF = { title: '', path: '', category: '' };
let isSplitView = false;
let leftPaneHidden = false;
let rightPaneHidden = false;
let allFiles = [];
let currentFilter = 'all';
let lastFocusedPane = 'left';
let isRestoringState = false;
let isHandlingPopstate = false; // Prevent any state push during popstate handling
let searchUrlUpdateTimeout = null;
let isFileOpening = false; // Prevent double-click on file list

// ============================================================================
// KEYBOARD INPUT PROTECTION UTILITIES
// ============================================================================
// Use this function in ALL global keyboard handlers to prevent interference
// with text input. This is critical to avoid bugs where users can't type
// spaces or other characters in input fields.

/**
 * Check if user is currently typing in a text input field.
 * Use at the START of every global keydown/keypress handler.
 * @returns {boolean} true if user is typing and keyboard events should be ignored
 */
function isUserTypingInInput() {
    const activeElement = document.activeElement;
    if (!activeElement) return false;

    return (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable ||
        activeElement.getAttribute('contenteditable') === 'true'
    );
}

// ============================================================================
// HISTORY MANAGEMENT
// ============================================================================

// Save PDF to history
async function saveToHistory(title, path, category, wasSplitView = false) {
    try {
        const response = await fetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, path, category, wasSplitView })
        });

        if (response.ok) {
            // Update history display
            await updateHistoryDisplay();
        } else {
            console.error('Failed to save history');
        }
    } catch (e) {
        console.error('Failed to save history:', e);
    }
}

// Load and display history (sidebar preview - only 8 items)
async function updateHistoryDisplay() {
    const historyList = document.getElementById('history-list');

    try {
        const response = await fetch('/api/history?limit=8');
        if (!response.ok) {
            throw new Error('Failed to fetch history');
        }

        const data = await response.json();
        const history = data.history || [];

        if (history.length === 0) {
            historyList.innerHTML = `
                <div class="history-empty">
                    <div class="history-empty-icon"><i class="fas fa-folder-open"></i></div>
                    <div>No recent documents</div>
                </div>
            `;
            return;
        }

        historyList.innerHTML = '';

        history.forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';

            // Extract lecture number for color coding
            const lectureMatch = item.category.match(/lecture[- ](\d+)/i) || item.path.match(/lecture[- ](\d+)/i);
            const lectureNum = lectureMatch ? lectureMatch[1] : null;
            if (lectureNum) {
                historyItem.setAttribute('data-lecture', lectureNum);
            }

            // Click handler - restore split view if it was previously in split mode
            historyItem.onclick = async () => {
                openPDF(item.title, item.path, item.category);

                // If this was viewed in split mode, try to restore the companion
                if (item.wasSplitView) {
                    const companionPath = await getSplitCompanion(item.path);
                    if (companionPath) {
                        const companionPDF = findPDFByPath(companionPath);
                        if (companionPDF) {
                            // Wait for the left PDF to load, then open split view
                            setTimeout(() => {
                                selectPDFForSplit(companionPDF.title, companionPDF.path, companionPDF.category, true);
                                showNotification(`Split view restored: ${companionPDF.title}`, 2500);
                            }, 600);
                        }
                    }
                }
            };

            const timeAgo = getTimeAgo(item.timestamp);
            const splitBadge = item.wasSplitView
                ? '<span class="history-item-split-badge"><i class="fas fa-columns"></i> Split</span>'
                : '';

            // Add lecture badge with color
            const lectureBadge = lectureNum
                ? `<span class="badge lecture-${lectureNum}" style="font-size: 7px; padding: 1px 3px;">L${lectureNum}</span>`
                : '';

            historyItem.innerHTML = `
                <div class="history-card-simple" style="background: #fff; border-left: 3px solid #007AFF; border-radius: 6px; padding: 6px 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.08);">
                    <div style="font-weight: 500; font-size: 11px; color: #1d1d1f; line-height: 1.3; word-wrap: break-word;">
                        ${item.title}${lectureBadge ? ` ${lectureBadge}` : ''}
                    </div>
                    <div style="font-size: 9px; color: #8e8e93; margin-top: 2px;">${timeAgo}</div>
                </div>
            `;

            historyList.appendChild(historyItem);
        });
    } catch (e) {
        console.error('Failed to load history:', e);
        historyList.innerHTML = `
            <div class="history-empty">
                <div style="color: #ff3b30;">Error loading history</div>
            </div>
        `;
    }
}

// Clear all history
async function clearHistory() {
    if (confirm('Clear all recent documents?')) {
        try {
            const response = await fetch('/api/history', { method: 'DELETE' });
            if (response.ok) {
                await updateHistoryDisplay();
                showNotification('History cleared');
            }
        } catch (e) {
            console.error('Failed to clear history:', e);
            showNotification('Failed to clear history', 3000);
        }
    }
}

// Get relative time string
function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;

    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================================
// URL ROUTING & STATE MANAGEMENT
// ============================================================================

// Encode PDF path for URL
function encodePathForURL(path) {
    // First decode to handle any existing encoding, then encode once
    // This prevents double-encoding issues
    try {
        let decoded = path;
        let prev = '';
        // Repeatedly decode until stable
        while (decoded !== prev) {
            prev = decoded;
            decoded = decodeURIComponent(decoded);
        }
        return encodeURIComponent(decoded);
    } catch (e) {
        return encodeURIComponent(path);
    }
}

// Decode PDF path from URL
function decodePathFromURL(encoded) {
    // Repeatedly decode until stable to handle multiple levels of encoding
    try {
        let decoded = encoded;
        let prev = '';
        while (decoded !== prev) {
            prev = decoded;
            decoded = decodeURIComponent(decoded);
        }
        return decoded;
    } catch (e) {
        return encoded;
    }
}

// Update URL based on current state
async function updateURL(pushState = true) {
    // Never push state during popstate handling - this would clear forward history
    if (isRestoringState || isHandlingPopstate) return;

    // Get current URL for comparison
    const currentFullURL = window.location.pathname + window.location.search;

    const params = new URLSearchParams();

    // Add left PDF
    if (currentLeftPDF.path) {
        params.set('left', encodePathForURL(currentLeftPDF.path));
    }

    // Add right PDF if split view is active
    if (isSplitView && currentRightPDF.path) {
        params.set('right', encodePathForURL(currentRightPDF.path));
    }

    // Add split ratio if customized
    if (isSplitView) {
        const savedRatio = await getPreference('splitViewRatio', '50');
        if (savedRatio && savedRatio !== '50') {
            params.set('ratio', savedRatio);
        }
    }

    // Always preserve filter state
    if (currentFilter && currentFilter !== 'all') {
        params.set('filter', currentFilter);
    }

    // Always preserve search term if present
    const searchInput = document.getElementById('main-search');
    if (searchInput && searchInput.value.trim()) {
        params.set('search', searchInput.value.trim());
    }

    // Determine the correct URL path
    let newURL;
    if (currentLeftPDF.path) {
        // PDF is being viewed - use /view? path
        newURL = params.toString() ? `/view?${params.toString()}` : '/';
    } else {
        // No PDF - use home path
        newURL = params.toString() ? `/?${params.toString()}` : '/';
    }

    const stateObj = {
        leftPDF: currentLeftPDF,
        rightPDF: currentRightPDF,
        isSplitView,
        filter: currentFilter,
        search: searchInput ? searchInput.value.trim() : ''
    };

    // Prevent duplicate history entries - don't push if URL is the same
    // Normalize URLs by decoding to handle double-encoding issues
    const normalizeURL = (url) => {
        try {
            // Repeatedly decode until stable to handle multiple levels of encoding
            let decoded = url;
            let prev = '';
            while (decoded !== prev) {
                prev = decoded;
                decoded = decodeURIComponent(decoded);
            }
            return decoded;
        } catch (e) {
            return url;
        }
    };

    if (pushState && normalizeURL(newURL) === normalizeURL(currentFullURL)) {
        // URL is the same, use replaceState instead to avoid duplicate entries
        window.history.replaceState(stateObj, '', newURL);
        return;
    }

    if (pushState) {
        window.history.pushState(stateObj, '', newURL);
    } else {
        window.history.replaceState(stateObj, '', newURL);
    }
}

// Update URL for filter/search state only (no PDF viewer)
function updateFilterURL(pushState = true) {
    // Never push state during popstate handling
    if (isRestoringState || isHandlingPopstate) return;

    // Don't update filter URL if PDF viewer or TeX editor is open
    const modal = document.getElementById('pdf-modal');
    if (modal && modal.style.display === 'block') {
        return; // PDF or TeX editor is open, don't overwrite their URL
    }

    // Get current URL for comparison
    const currentFullURL = window.location.pathname + window.location.search;

    const params = new URLSearchParams();

    // Add category/lecture filter
    if (currentFilter && currentFilter !== 'all') {
        params.set('filter', currentFilter);
    }

    // Add search term if present
    const searchInput = document.getElementById('main-search');
    if (searchInput && searchInput.value.trim()) {
        params.set('search', searchInput.value.trim());
    }

    const newURL = params.toString() ? `/?${params.toString()}` : '/';

    const stateObj = {
        home: true,
        filter: currentFilter,
        search: searchInput ? searchInput.value.trim() : ''
    };

    // Prevent duplicate history entries - don't push if URL is the same
    if (pushState && newURL === currentFullURL) {
        window.history.replaceState(stateObj, '', newURL);
        return;
    }

    if (pushState) {
        window.history.pushState(stateObj, '', newURL);
    } else {
        window.history.replaceState(stateObj, '', newURL);
    }
}

// Update URL for TeX editor state
function updateTexEditorURL(texPath, pushState = true) {
    // Never push state during popstate handling
    if (isRestoringState || isHandlingPopstate) return;

    // Get current URL for comparison
    const currentFullURL = window.location.pathname + window.location.search;

    const params = new URLSearchParams();
    params.set('tex', encodePathForURL(texPath));

    // Preserve filter state
    if (currentFilter && currentFilter !== 'all') {
        params.set('filter', currentFilter);
    }

    // Preserve search state
    const searchInput = document.getElementById('main-search');
    const searchTerm = searchInput ? searchInput.value.trim() : '';
    if (searchTerm) {
        params.set('search', searchTerm);
    }

    const newURL = `/?${params.toString()}`;

    const stateObj = {
        texEditor: true,
        texPath: texPath,
        filter: currentFilter,
        search: searchTerm
    };

    // Prevent duplicate history entries - don't push if URL is the same
    if (pushState && newURL === currentFullURL) {
        window.history.replaceState(stateObj, '', newURL);
        return;
    }

    if (pushState) {
        window.history.pushState(stateObj, '', newURL);
    } else {
        window.history.replaceState(stateObj, '', newURL);
    }
}

// Save split view companion to database
async function saveSplitCompanion(leftPath, rightPath) {
    try {
        const response = await fetch('/api/split-companion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leftPath, rightPath })
        });

        if (!response.ok) {
            console.error('Failed to save split companion');
        }
    } catch (e) {
        console.error('Failed to save split companion:', e);
    }
}

// Get split view companion from database
async function getSplitCompanion(pdfPath) {
    try {
        const response = await fetch(`/api/split-companion/${encodeURIComponent(pdfPath)}`);
        if (response.ok) {
            const data = await response.json();
            return data.companion;
        }
        return null;
    } catch (e) {
        console.error('Failed to get split companion:', e);
        return null;
    }
}

// ============================================================================
// PREFERENCES MANAGEMENT
// ============================================================================

// Set a preference in the database
async function setPreference(key, value) {
    try {
        const response = await fetch('/api/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });

        if (!response.ok) {
            console.error('Failed to save preference');
        }
    } catch (e) {
        console.error('Failed to save preference:', e);
    }
}

// Get a preference from the database
async function getPreference(key, defaultValue = null) {
    try {
        const response = await fetch(`/api/preferences/${encodeURIComponent(key)}`);
        if (response.ok) {
            const data = await response.json();
            return data.value !== null ? data.value : defaultValue;
        }
        return defaultValue;
    } catch (e) {
        console.error('Failed to get preference:', e);
        return defaultValue;
    }
}

// Find PDF info by path
function findPDFByPath(path) {
    // Search in notes
    for (const [lectureName, pdfs] of Object.entries(pdfStructure.notes)) {
        const found = pdfs.find(pdf => pdf.path === path);
        if (found) return { title: found.title, path: found.path, category: lectureName };
    }

    // Search in slides
    const slideFound = pdfStructure.slides.find(pdf => pdf.path === path);
    if (slideFound) return { title: slideFound.title, path: slideFound.path, category: 'Lecture Slides' };

    // Search in exercises
    const exerciseFound = pdfStructure.exercises.find(pdf => pdf.path === path);
    if (exerciseFound) return { title: exerciseFound.title, path: exerciseFound.path, category: 'Exercises' };

    // Search in exercises without solutions
    const exerciseNoSolFound = pdfStructure.exercisesNoSolutions.find(pdf => pdf.path === path);
    if (exerciseNoSolFound) return { title: exerciseNoSolFound.title, path: exerciseNoSolFound.path, category: 'Exercises (No Solutions)' };

    // Search in blueprint
    const blueprintFound = pdfStructure.blueprint.find(pdf => pdf.path === path);
    if (blueprintFound) return { title: blueprintFound.title, path: blueprintFound.path, category: 'Blueprint' };

    // Search in teachers method
    if (pdfStructure.teachersMethod) {
        const teachersFound = pdfStructure.teachersMethod.find(pdf => pdf.path === path);
        if (teachersFound) return { title: teachersFound.title, path: teachersFound.path, category: 'Teachers Method' };
    }

    // Search in custom categories
    if (pdfStructure.customCategories) {
        for (const [categoryName, pdfs] of Object.entries(pdfStructure.customCategories)) {
            const found = pdfs.find(pdf => pdf.path === path);
            if (found) return { title: found.title, path: found.path, category: categoryName };
        }
    }

    // Fallback: search in allFiles array
    if (typeof allFiles !== 'undefined' && Array.isArray(allFiles)) {
        const fileFound = allFiles.find(f => f.path === path);
        if (fileFound) return { title: fileFound.name, path: fileFound.path, category: fileFound.category || '' };
    }

    return null;
}

// Show notification
function showNotification(message, duration = 3000) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 30px;
        right: 30px;
        background: rgba(0, 0, 0, 0.9);
        backdrop-filter: blur(20px);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10001;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        animation: slideIn 0.3s ease;
        max-width: 400px;
    `;
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 20px;"><i class="fas fa-info-circle"></i></span>
            <span>${message}</span>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideOut {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(20px); }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            notification.remove();
            style.remove();
        }, 300);
    }, duration);
}

// Restore state from URL
async function restoreStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    const texPath = params.get('tex');
    const leftPath = params.get('left');
    const rightPath = params.get('right');
    const ratio = params.get('ratio');
    const filter = params.get('filter');
    const search = params.get('search');

    isRestoringState = true;

    // Handle tex editor from URL parameter (priority over PDF)
    if (texPath) {
        const decodedTexPath = decodePathFromURL(texPath);

        // Restore filter if present
        if (filter) {
            filterByCategory(filter, false);
        }

        // Validate tex file with server API
        try {
            const response = await fetch(`/api/tex-info/${encodeURIComponent(decodedTexPath)}`);
            const data = await response.json();

            if (data.success && data.file && typeof openTexEditor === 'function') {
                // File exists on server - open it with proper metadata
                setTimeout(() => {
                    openTexEditor(data.file.name, data.file.path, data.file.category, false);
                    isRestoringState = false;
                }, 100);
            } else {
                // File not found on server - show notification and redirect to home
                console.warn('TeX file not found:', decodedTexPath);
                showNotification('TeX file not found: ' + decodedTexPath.split('/').pop(), 4000);
                // Update URL to home state
                window.history.replaceState({ home: true, filter: filter || 'all' }, '', filter ? `/?filter=${filter}` : '/');
                isRestoringState = false;
            }
        } catch (error) {
            console.error('Error validating tex file:', error);
            // Fallback: try to open from allFiles list
            const texFile = allFiles.find(f => f.path === decodedTexPath);
            if (texFile && typeof openTexEditor === 'function') {
                setTimeout(() => {
                    openTexEditor(texFile.name, texFile.path, texFile.category, false);
                    isRestoringState = false;
                }, 100);
            } else {
                showNotification('Error loading TeX file', 3000);
                window.history.replaceState({ home: true, filter: filter || 'all' }, '', filter ? `/?filter=${filter}` : '/');
                isRestoringState = false;
            }
        }
        return;
    }

    // Restore filter state if present (and no PDF is being opened)
    if (!leftPath && filter) {
        filterByCategory(filter, false);
    }

    // Restore search state if present (and no PDF is being opened)
    if (!leftPath && search) {
        const searchInput = document.getElementById('main-search');
        if (searchInput) {
            searchInput.value = search;
            filterMainFilesInternal(false);
        }
    }

    if (leftPath) {
        const decodedLeftPath = decodePathFromURL(leftPath);
        const leftPDF = findPDFByPath(decodedLeftPath);

        if (leftPDF) {
            // Open left PDF without updating URL
            openPDFInternal(leftPDF.title, leftPDF.path, leftPDF.category, false);

            // Check if there's a right PDF or a saved companion
            let rightPDFPath = rightPath ? decodePathFromURL(rightPath) : null;
            let isFromCompanion = false;

            // If no right path in URL, check database for companion
            if (!rightPDFPath) {
                rightPDFPath = await getSplitCompanion(decodedLeftPath);
                isFromCompanion = true;
            }

            if (rightPDFPath) {
                const rightPDF = findPDFByPath(rightPDFPath);
                if (rightPDF) {
                    setTimeout(() => {
                        selectPDFForSplit(rightPDF.title, rightPDF.path, rightPDF.category, false);

                        // Apply custom ratio if specified (with bounds validation)
                        if (ratio) {
                            const ratioValue = parseFloat(ratio);
                            if (!isNaN(ratioValue) && ratioValue >= 10 && ratioValue <= 90) {
                                applySplitRatio(ratioValue);
                            }
                        }

                        // Show notification if restored from companion
                        if (isFromCompanion) {
                            setTimeout(() => {
                                showNotification(`Split view restored: ${rightPDF.title}`);
                            }, 800);
                        }

                        isRestoringState = false;
                    }, 500);
                    return;
                }
            }
        }
    }

    isRestoringState = false;
}

// Handle browser back/forward buttons
window.addEventListener('popstate', (event) => {
    // Set flag to prevent any state pushes during popstate handling
    // This prevents clearing forward history
    isHandlingPopstate = true;

    // Reset the flag after all async operations complete (max 1 second)
    setTimeout(() => {
        isHandlingPopstate = false;
    }, 1000);

    const modal = document.getElementById('pdf-modal');

    // If navigating to home state (no PDF/tex), close the modal and restore filter/search
    if (event.state && event.state.home) {
        if (modal && modal.style.display === 'block') {
            isRestoringState = true;
            // Close tex editor if open (without triggering URL update)
            if (typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen && typeof closeTexEditor === 'function') {
                closeTexEditor();
            }
            closePDFInternal();
            isRestoringState = false;
        }

        // Restore filter and search from state
        isRestoringState = true;
        if (event.state.filter) {
            filterByCategory(event.state.filter, false);
        } else {
            filterByCategory('all', false);
        }

        const searchInput = document.getElementById('main-search');
        if (searchInput) {
            if (event.state.search) {
                searchInput.value = event.state.search;
                filterMainFilesInternal(false);
            } else {
                searchInput.value = '';
                filterMainFilesInternal(false);
            }
        }
        isRestoringState = false;
        return;
    }

    // Handle tex editor state from history
    if (event.state && event.state.texEditor && event.state.texPath) {
        isRestoringState = true;

        // Close current modal first if open
        if (modal && modal.style.display === 'block') {
            if (typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen && typeof closeTexEditor === 'function') {
                closeTexEditor();
            }
            closePDFInternal();
        }

        const texPath = event.state.texPath;
        const filter = event.state.filter;

        // Validate tex file with server API
        fetch(`/api/tex-info/${encodeURIComponent(texPath)}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                if (data.success && data.file && typeof openTexEditor === 'function') {
                    // Use timeout to allow DOM to settle
                    setTimeout(() => {
                        openTexEditor(data.file.name, data.file.path, data.file.category, false);
                        isRestoringState = false;
                    }, 100);
                } else {
                    // File not found - show notification and go home
                    console.warn('TeX file not found:', texPath);
                    if (typeof showNotification === 'function') {
                        showNotification('TeX file not found', 3000);
                    }
                    window.history.replaceState({ home: true, filter: filter || 'all', search: '' }, '', filter ? `/?filter=${filter}` : '/');
                    isRestoringState = false;
                }

                // Restore filter if present
                if (filter) {
                    filterByCategory(filter, false);
                }
            })
            .catch(error => {
                console.error('Error validating tex file:', error);
                // Fallback to allFiles list
                const texFile = Array.isArray(allFiles) ? allFiles.find(f => f.path === texPath) : null;
                if (texFile && typeof openTexEditor === 'function') {
                    setTimeout(() => {
                        openTexEditor(texFile.name, texFile.path, texFile.category, false);
                        isRestoringState = false;
                    }, 100);
                } else {
                    if (typeof showNotification === 'function') {
                        showNotification('Error loading TeX file', 3000);
                    }
                    window.history.replaceState({ home: true, filter: filter || 'all', search: '' }, '', filter ? `/?filter=${filter}` : '/');
                    isRestoringState = false;
                }
                if (filter) {
                    filterByCategory(filter, false);
                }
            });
        return;
    }

    // Try to restore from event.state
    if (event.state && event.state.leftPDF && event.state.leftPDF.path) {
        isRestoringState = true;

        // If going back from split view to single view, close split view first
        if (isSplitView && !event.state.isSplitView) {
            closeSplitView();
        }

        // Restore from state
        setTimeout(() => {
            openPDFInternal(
                event.state.leftPDF.title,
                event.state.leftPDF.path,
                event.state.leftPDF.category,
                false
            );

            if (event.state.isSplitView && event.state.rightPDF && event.state.rightPDF.path) {
                setTimeout(() => {
                    selectPDFForSplit(
                        event.state.rightPDF.title,
                        event.state.rightPDF.path,
                        event.state.rightPDF.category,
                        false
                    );
                    isRestoringState = false;
                }, 500);
            } else {
                isRestoringState = false;
            }
        }, 100);
    } else {
        // No state - check URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const texFile = urlParams.get('tex');
        const leftPDF = urlParams.get('left');
        const rightPDF = urlParams.get('right');
        const ratio = urlParams.get('ratio');
        const filter = urlParams.get('filter');
        const search = urlParams.get('search');

        // Handle tex editor from URL parameter
        if (texFile) {
            isRestoringState = true;

            if (modal && modal.style.display === 'block') {
                if (typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen && typeof closeTexEditor === 'function') {
                    closeTexEditor();
                }
                closePDFInternal();
            }

            const texPath = decodePathFromURL(texFile);

            // Validate tex file with server API
            fetch(`/api/tex-info/${encodeURIComponent(texPath)}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.success && data.file && typeof openTexEditor === 'function') {
                        // Use timeout to allow DOM to settle
                        setTimeout(() => {
                            openTexEditor(data.file.name, data.file.path, data.file.category, false);
                            isRestoringState = false;
                        }, 100);
                    } else {
                        // File not found - show notification and go home
                        console.warn('TeX file not found:', texPath);
                        if (typeof showNotification === 'function') {
                            showNotification('TeX file not found', 3000);
                        }
                        window.history.replaceState({ home: true, filter: filter || 'all', search: '' }, '', filter ? `/?filter=${filter}` : '/');
                        isRestoringState = false;
                    }

                    // Restore filter if present
                    if (filter) {
                        filterByCategory(filter, false);
                    }
                })
                .catch(error => {
                    console.error('Error validating tex file:', error);
                    // Fallback to allFiles list
                    const foundTexFile = Array.isArray(allFiles) ? allFiles.find(f => f.path === texPath) : null;
                    if (foundTexFile && typeof openTexEditor === 'function') {
                        setTimeout(() => {
                            openTexEditor(foundTexFile.name, foundTexFile.path, foundTexFile.category, false);
                            isRestoringState = false;
                        }, 100);
                    } else {
                        if (typeof showNotification === 'function') {
                            showNotification('Error loading TeX file', 3000);
                        }
                        isRestoringState = false;
                    }
                    if (filter) {
                        filterByCategory(filter, false);
                    }
                });
            return;
        }

        if (leftPDF) {
            // Restore from URL parameters
            isRestoringState = true;

            // If going back from split view to single view (no right PDF in URL), close split view
            if (isSplitView && !rightPDF) {
                closeSplitView();
            }

            if (modal && modal.style.display === 'block' && !leftPDF) {
                closePDFInternal();
            }

            setTimeout(() => {
                const leftPath = decodePathFromURL(leftPDF);
                const leftFile = findPDFByPath(leftPath);

                if (leftFile) {
                    openPDFInternal(leftFile.title, leftFile.path, leftFile.category, false);

                    if (rightPDF) {
                        const rightPath = decodePathFromURL(rightPDF);
                        const rightFile = findPDFByPath(rightPath);

                        if (rightFile) {
                            setTimeout(() => {
                                selectPDFForSplit(rightFile.title, rightFile.path, rightFile.category, false);
                                // Apply custom ratio if specified in URL
                                if (ratio && typeof applySplitRatio === 'function') {
                                    const ratioValue = parseFloat(ratio);
                                    if (!isNaN(ratioValue) && ratioValue >= 10 && ratioValue <= 90) {
                                        applySplitRatio(ratioValue);
                                    }
                                }
                                isRestoringState = false;
                            }, 500);
                        } else {
                            // Right PDF not found - show notification
                            if (typeof showNotification === 'function') {
                                showNotification('Split view PDF not found', 3000);
                            }
                            isRestoringState = false;
                        }
                    } else {
                        isRestoringState = false;
                    }
                } else {
                    // Left PDF not found - show notification and clean URL
                    if (typeof showNotification === 'function') {
                        showNotification('PDF file not found', 3000);
                    }
                    window.history.replaceState({ home: true, filter: filter || 'all' }, '', filter ? `/?filter=${filter}` : '/');
                    isRestoringState = false;
                }
            }, 100);
        } else {
            // No PDF in URL - close modal and restore filter/search from URL
            if (modal && modal.style.display === 'block') {
                isRestoringState = true;
                closePDFInternal();
                isRestoringState = false;
            }

            // Restore filter and search from URL params
            isRestoringState = true;
            if (filter) {
                filterByCategory(filter, false);
            } else {
                filterByCategory('all', false);
            }

            const searchInput = document.getElementById('main-search');
            if (searchInput) {
                if (search) {
                    searchInput.value = search;
                    filterMainFilesInternal(false);
                } else {
                    searchInput.value = '';
                    filterMainFilesInternal(false);
                }
            }
            isRestoringState = false;
        }
    }
});

// Fetch PDF structure from server
async function loadPDFStructure() {
    try {
        const response = await fetch('/api/files');
        if (!response.ok) {
            throw new Error('Failed to fetch PDF structure');
        }
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to load files');
        }

        pdfStructure = data.structure;

        // Update navbar with current subject info
        if (data.subject) {
            const nameElement = document.getElementById('subject-name');
            const semesterElement = document.getElementById('subject-semester');
            const iconElement = document.getElementById('subject-icon');
            const breadcrumbElement = document.getElementById('breadcrumb-subject');

            if (nameElement) nameElement.textContent = data.subject.name;
            if (semesterElement) semesterElement.textContent = data.subject.semester || '';
            if (breadcrumbElement) breadcrumbElement.textContent = data.subject.name.toLowerCase();

            if (iconElement) {
                iconElement.className = `fas ${data.subject.icon} text-primary me-2`;
                if (data.subject.color) {
                    iconElement.style.color = data.subject.color;
                }
            }
        }

        buildFileList(); // This populates pdfStructure.lectures
        populateLecturesSidebar(); // Must be after buildFileList
        await loadCustomCategories(); // Load custom categories from backend
        updateCustomCategoriesInSidebar(); // Populate custom categories into sidebar
        updateCounts(); // Must be after sidebars are populated so count elements exist
        updateHistoryDisplay();

        // Restore state from URL after loading structure
        setTimeout(() => {
            restoreStateFromURL();
        }, 100);
    } catch (error) {
        console.error('Error loading PDF structure:', error);
        // Show error message to user
        const tbody = document.getElementById('file-list-body');
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 40px; color: #ff3b30;">
                    <div style="font-size: 48px; margin-bottom: 16px;"><i class="fas fa-exclamation-triangle"></i></div>
                    <div style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">Failed to load PDF files</div>
                    <div style="font-size: 13px; color: #86868b;">${error.message}</div>
                </td>
            </tr>
        `;
    }
}

// Format category name from "lab-work" to "Lab Work"
function formatCategoryName(categoryName) {
    return categoryName
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Dynamically populate lectures sidebar
function populateLecturesSidebar() {
    const lecturesList = document.getElementById('lectures-list');
    lecturesList.innerHTML = '';

    if (pdfStructure.lectures && pdfStructure.lectures.length > 0) {
        pdfStructure.lectures.forEach(lectureId => {
            const lectureNum = lectureId.replace('lecture-', '');

            // Simple display name - just "Lecture X"
            const displayName = `Lecture ${lectureNum}`;

            const lectureItem = document.createElement('a');
            lectureItem.href = '#';
            lectureItem.className = 'list-group-item list-group-item-action sidebar-item';
            lectureItem.onclick = (e) => { e.preventDefault(); filterByCategory(lectureId); };
            lectureItem.innerHTML = `
                <span class="sidebar-icon"><i class="fas fa-folder"></i></span>
                <span>${displayName}</span>
                <span class="badge bg-primary rounded-pill sidebar-count" id="count-${lectureId}">0</span>
            `;
            lecturesList.appendChild(lectureItem);
        });
    }
}

// Populate custom categories in sidebar
function populateCustomCategoriesSidebar() {
    const customList = document.getElementById('custom-categories-list');
    customList.innerHTML = '';

    if (pdfStructure.customCategories && Object.keys(pdfStructure.customCategories).length > 0) {
        for (const [categoryName, pdfs] of Object.entries(pdfStructure.customCategories)) {
            const displayName = formatCategoryName(categoryName);
            const categoryItem = document.createElement('a');
            categoryItem.href = '#';
            categoryItem.className = 'list-group-item list-group-item-action sidebar-item';
            categoryItem.onclick = (e) => { e.preventDefault(); filterByCategory(categoryName); };
            categoryItem.innerHTML = `
                <span class="sidebar-icon"><i class="fas fa-folder-open"></i></span>
                <span>${displayName}</span>
                <span class="badge bg-secondary rounded-pill sidebar-count" id="count-${categoryName}">0</span>
            `;
            customList.appendChild(categoryItem);
        }
    }
}

// Build flat file list
function buildFileList() {
    allFiles = [];

    // Build lectures list from notes
    const lecturesSet = new Set();

    // Add custom categories first
    if (pdfStructure.customCategories) {
        for (const [categoryName, pdfs] of Object.entries(pdfStructure.customCategories)) {
            pdfs.forEach(pdf => {
                const isTexFile = pdf.fileType === 'tex';
                allFiles.push({
                    name: pdf.title,
                    path: pdf.path,
                    category: formatCategoryName(categoryName),
                    type: isTexFile ? 'TEX' : 'PDF',
                    fileType: categoryName,
                    lecture: pdf.lecture,
                    lectureId: pdf.lecture ? `lecture-${pdf.lecture}` : null,
                    isCustomCategory: true,
                    isTexFile: isTexFile
                });

                // Track lectures from custom categories too
                if (pdf.lecture && pdf.lecture !== 'other') {
                    lecturesSet.add(pdf.lecture);
                }
            });
        }
    }

    // Add notes
    for (const [lectureName, pdfs] of Object.entries(pdfStructure.notes)) {
        pdfs.forEach(pdf => {
            // Add to lectures set for sidebar
            if (pdf.lecture && pdf.lecture !== 'other') {
                lecturesSet.add(pdf.lecture);
            }

            // Format category name properly
            const categoryDisplay = lectureName === 'other'
                ? 'Other Notes'
                : `Lecture Notes`;

            const isTexFile = pdf.fileType === 'tex';
            allFiles.push({
                name: pdf.title,
                path: pdf.path,
                category: categoryDisplay,
                type: isTexFile ? 'TEX' : 'PDF',
                fileType: 'notes',
                lecture: pdf.lecture,
                lectureId: pdf.lecture ? `lecture-${pdf.lecture}` : null,
                isTexFile: isTexFile
            });
        });
    }

    // Add slides
    pdfStructure.slides.forEach(pdf => {
        if (pdf.lecture && pdf.lecture !== 'other') {
            lecturesSet.add(pdf.lecture);
        }

        const isTexFile = pdf.fileType === 'tex';
        allFiles.push({
            name: pdf.title,
            path: pdf.path,
            category: 'Lecture Slides',
            type: isTexFile ? 'TEX' : 'PDF',
            fileType: 'slides',
            lecture: pdf.lecture,
            lectureId: pdf.lecture ? `lecture-${pdf.lecture}` : null,
            isTexFile: isTexFile
        });
    });

    // Add exercises
    pdfStructure.exercises.forEach(pdf => {
        if (pdf.lecture && pdf.lecture !== 'other') {
            lecturesSet.add(pdf.lecture);
        }

        const isTexFile = pdf.fileType === 'tex';
        allFiles.push({
            name: pdf.title,
            path: pdf.path,
            category: 'Exercises',
            type: isTexFile ? 'TEX' : 'PDF',
            fileType: 'exercises',
            lecture: pdf.lecture,
            lectureId: pdf.lecture ? `lecture-${pdf.lecture}` : null,
            isTexFile: isTexFile
        });
    });

    // Add exercises without solutions
    pdfStructure.exercisesNoSolutions.forEach(pdf => {
        if (pdf.lecture && pdf.lecture !== 'other') {
            lecturesSet.add(pdf.lecture);
        }

        const isTexFile = pdf.fileType === 'tex';
        allFiles.push({
            name: pdf.title,
            path: pdf.path,
            category: 'Exercises (No Solutions)',
            type: isTexFile ? 'TEX' : 'PDF',
            fileType: 'exercises-no-solutions',
            lecture: pdf.lecture,
            lectureId: pdf.lecture ? `lecture-${pdf.lecture}` : null,
            isTexFile: isTexFile
        });
    });

    // Add blueprint files
    pdfStructure.blueprint.forEach(pdf => {
        const isTexFile = pdf.fileType === 'tex';
        allFiles.push({
            name: pdf.title,
            path: pdf.path,
            category: 'Blueprint',
            type: isTexFile ? 'TEX' : 'PDF',
            fileType: 'blueprint',
            lecture: pdf.lecture,
            lectureId: pdf.lecture ? `lecture-${pdf.lecture}` : null,
            isTexFile: isTexFile
        });
    });

    // Add teachers method files
    pdfStructure.teachersMethod.forEach(pdf => {
        const isTexFile = pdf.fileType === 'tex';
        allFiles.push({
            name: pdf.title,
            path: pdf.path,
            category: 'Teachers Method',
            type: isTexFile ? 'TEX' : 'PDF',
            fileType: 'teachers-method',
            lecture: pdf.lecture,
            lectureId: pdf.lecture ? `lecture-${pdf.lecture}` : null,
            isTexFile: isTexFile
        });
    });

    // Populate lectures array for sidebar
    pdfStructure.lectures = Array.from(lecturesSet).sort((a, b) => a - b).map(num => `lecture-${num}`);

    // Note: updateCounts() will be called after sidebar is populated
    renderFileList();
}

// Update sidebar counts
function updateCounts() {
    document.getElementById('count-all').textContent = allFiles.length;
    document.getElementById('count-notes').textContent = allFiles.filter(f => f.fileType === 'notes').length;
    document.getElementById('count-slides').textContent = allFiles.filter(f => f.fileType === 'slides').length;
    document.getElementById('count-exercises').textContent = allFiles.filter(f => f.fileType === 'exercises').length;
    document.getElementById('count-exercises-no-solutions').textContent = allFiles.filter(f => f.fileType === 'exercises-no-solutions').length;
    document.getElementById('count-blueprint').textContent = allFiles.filter(f => f.fileType === 'blueprint').length;
    document.getElementById('count-teachers-method').textContent = allFiles.filter(f => f.fileType === 'teachers-method').length;

    // Dynamically update counts for all lectures
    if (pdfStructure.lectures) {
        pdfStructure.lectures.forEach(lectureId => {
            const countElement = document.getElementById(`count-${lectureId}`);
            if (countElement) {
                countElement.textContent = allFiles.filter(f => f.lectureId === lectureId).length;
            }
        });
    }

    // Update counts for custom categories from localStorage
    customCategories.forEach(cat => {
        const countElement = document.getElementById(`count-${cat.id}`);
        if (countElement) {
            countElement.textContent = allFiles.filter(f => f.fileType === cat.id).length;
        }
    });
}

// Render file list
function renderFileList() {
    const tbody = document.getElementById('file-list-body');
    tbody.innerHTML = '';

    allFiles.forEach((file, index) => {
        const tr = document.createElement('tr');
        tr.dataset.index = index;
        tr.dataset.filePath = file.path; // For file manager features
        tr.dataset.fileType = file.fileType;
        tr.dataset.lecture = file.lecture;
        tr.dataset.lectureId = file.lectureId || '';
        tr.dataset.isCustomCategory = file.isCustomCategory || false;
        tr.dataset.isTexFile = file.isTexFile || false;
        tr.dataset.searchText = `${file.name} ${file.category} ${file.path}`.toLowerCase();

        // Different click handler for .tex files (with double-click prevention)
        if (file.isTexFile) {
            tr.onclick = () => {
                if (isFileOpening) return;
                isFileOpening = true;
                // Clear any pending search URL update to prevent race condition
                if (searchUrlUpdateTimeout) {
                    clearTimeout(searchUrlUpdateTimeout);
                    searchUrlUpdateTimeout = null;
                }
                // Safety: ensure isRestoringState is false for user action
                isRestoringState = false;
                openTexEditor(file.name, file.path, file.category);
                setTimeout(() => { isFileOpening = false; }, 500);
            };
        } else {
            tr.onclick = () => {
                if (isFileOpening) return;
                isFileOpening = true;
                openPDF(file.name, file.path, file.category);
                setTimeout(() => { isFileOpening = false; }, 500);
            };
        }

        // Extract lecture number for data attribute
        // file.lecture can be a number or null, so use it directly
        const lectureNum = file.lecture;
        if (lectureNum) {
            tr.setAttribute('data-lecture', lectureNum);
        }

        // Create lecture badge with color
        const lectureBadge = lectureNum
            ? `<span class="badge lecture-${lectureNum}" style="font-size: 8px; padding: 2px 4px; margin-left: 4px;">L${lectureNum}</span>`
            : '';

        // Compact path display - show only last part, expand on click
        const pathParts = file.path.split('/');
        const shortPath = pathParts.length > 2
            ? `.../${pathParts[pathParts.length - 1]}`
            : file.path;

        // Different icon for .tex files
        const fileIcon = file.isTexFile
            ? '<span class="file-icon tex"><i class="fas fa-file-code"></i></span>'
            : '<span class="file-icon pdf"><i class="fas fa-file-pdf"></i></span>';

        tr.innerHTML = `
            <td>
                <div class="file-name">
                    ${fileIcon}
                    <span>${file.name}</span>
                    ${lectureBadge}
                </div>
            </td>
            <td>${file.category}</td>
            <td><span class="file-type">${file.type}</span></td>
            <td>
                <span class="file-path compact-path" title="${file.path}" data-full-path="${file.path}">
                    ${shortPath}
                    <i class="fas fa-folder path-expand-icon" onclick="event.stopPropagation(); togglePathExpand(this);"></i>
                </span>
            </td>
            <td>
                <button class="btn btn-sm" onclick="event.stopPropagation(); openFileManageModal(allFiles[${index}], event);"
                        style="padding: 4px 8px; border-radius: 4px; border: 1px solid #d1d1d6; background: white; cursor: pointer; font-size: 12px;"
                        title="Manage file">
                    <i class="fas fa-cog"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

// Filter by category
function filterByCategory(category, updateUrl = true) {
    currentFilter = category;

    // Update sidebar active state
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.classList.remove('active');
    });
    if (event && event.target) {
        const sidebarItem = event.target.closest('.sidebar-item');
        if (sidebarItem) sidebarItem.classList.add('active');
    } else {
        // Find and activate the correct sidebar item programmatically
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        sidebarItems.forEach(item => {
            const onclick = item.getAttribute('onclick') || '';
            if (onclick.includes(`'${category}'`) || onclick.includes(`"${category}"`)) {
                item.classList.add('active');
            }
        });
    }

    // Update breadcrumb dynamically
    let locationText = '';
    if (category === 'all') {
        locationText = 'All Files';
    } else if (category === 'notes') {
        locationText = 'Lecture Notes';
    } else if (category === 'slides') {
        locationText = 'Lecture Slides';
    } else if (category === 'exercises') {
        locationText = 'Exercises';
    } else if (category === 'exercises-no-solutions') {
        locationText = 'Exercises (No Solutions)';
    } else if (category === 'blueprint') {
        locationText = 'Blueprint';
    } else if (category === 'teachers-method') {
        locationText = 'Teachers Method';
    } else if (category.startsWith('lecture-')) {
        const lectureNum = category.replace('lecture-', '');
        // Get descriptive name from lectureFolders
        if (pdfStructure.lectureFolders && pdfStructure.lectureFolders[lectureNum]) {
            locationText = pdfStructure.lectureFolders[lectureNum];
        } else {
            locationText = `Lecture ${lectureNum}`;
        }
    } else {
        locationText = category;
    }
    document.getElementById('current-location').textContent = locationText;

    // Filter files
    const rows = document.querySelectorAll('.file-list tbody tr');
    rows.forEach(row => {
        const fileType = row.dataset.fileType;
        const lectureId = row.dataset.lectureId;
        const isCustom = row.dataset.isCustomCategory === 'true';

        if (category === 'all') {
            row.classList.remove('hidden');
        } else if (category === 'notes' || category === 'slides' || category === 'exercises' || category === 'exercises-no-solutions' || category === 'blueprint' || category === 'teachers-method') {
            row.classList.toggle('hidden', fileType !== category);
        } else if (category.startsWith('lecture-')) {
            row.classList.toggle('hidden', lectureId !== category);
        } else {
            // Custom category
            row.classList.toggle('hidden', fileType !== category || !isCustom);
        }
    });

    // Update URL to reflect current filter state
    if (updateUrl) {
        updateFilterURL(true);
    }
}

// Set view (toolbar buttons)
function setView(view, updateUrl = true) {
    // Update button states
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // Programmatically activate the correct button
        document.querySelectorAll('.view-btn').forEach(btn => {
            if (btn.textContent.toLowerCase().includes(view) ||
                (view === 'all' && btn.textContent.toLowerCase() === 'all')) {
                btn.classList.add('active');
            }
        });
    }

    // Filter files
    const rows = document.querySelectorAll('.file-list tbody tr');
    rows.forEach(row => {
        const fileType = row.dataset.fileType;

        if (view === 'all') {
            row.classList.remove('hidden');
        } else {
            row.classList.toggle('hidden', fileType !== view);
        }
    });

    currentFilter = view;

    // Update URL to reflect current filter state
    if (updateUrl) {
        updateFilterURL(true);
    }
}

// Filter main files (search)
function filterMainFiles() {
    const searchTerm = document.getElementById('main-search').value.toLowerCase();
    const rows = document.querySelectorAll('.file-list tbody tr');

    // Reset counts if search is empty
    if (!searchTerm) {
        updateCounts();
        document.querySelectorAll('.sidebar-item').forEach(item => item.style.display = 'flex');

        // Re-apply current category filter visibility
        rows.forEach(row => {
            const fileType = row.dataset.fileType;
            const lectureId = row.dataset.lectureId;

            if (currentFilter === 'all') {
                row.classList.remove('hidden');
            } else if (currentFilter === 'notes' || currentFilter === 'slides' || currentFilter === 'exercises' || currentFilter === 'exercises-no-solutions' || currentFilter === 'blueprint' || currentFilter === 'teachers-method') {
                row.classList.toggle('hidden', fileType !== currentFilter);
            } else if (currentFilter.startsWith('lecture-')) {
                row.classList.toggle('hidden', lectureId !== currentFilter);
            }
        });
        return;
    }

    // Track counts for search results
    const counts = {
        all: 0,
        notes: 0,
        slides: 0,
        exercises: 0,
        'exercises-no-solutions': 0,
        blueprint: 0,
        'teachers-method': 0
    };
    const lectureCounts = {};

    rows.forEach(row => {
        const searchText = row.dataset.searchText;
        const matchesSearch = searchText.includes(searchTerm);
        const fileType = row.dataset.fileType;
        const lecture = row.dataset.lecture;

        // Update visibility based on search ONLY (ignore current category filter for now to show global search results)
        // OR should we respect the current filter? The user asked to "find what I am searching for", usually implies global search.
        // Let's keep the current behavior of filtering the LIST, but we need to update the SIDEBAR to show where matches are.

        // Actually, standard behavior for "search" is often global. 
        // But the current implementation applies both. Let's stick to the current implementation for the file list,
        // BUT update the sidebar counts based on GLOBAL matches to guide the user.

        if (matchesSearch) {
            counts.all++;
            if (counts[fileType] !== undefined) counts[fileType]++;

            if (lecture) {
                lectureCounts[lecture] = (lectureCounts[lecture] || 0) + 1;
            }
        }

        // Apply both filter and search for the file list view
        let matchesFilter = false;
        if (currentFilter === 'all') {
            matchesFilter = true;
        } else if (currentFilter === 'notes' || currentFilter === 'slides' || currentFilter === 'exercises' || currentFilter === 'exercises-no-solutions' || currentFilter === 'blueprint' || currentFilter === 'teachers-method') {
            matchesFilter = fileType === currentFilter;
        } else if (currentFilter.startsWith('lecture-')) {
            matchesFilter = lecture === currentFilter;
        }

        row.classList.toggle('hidden', !(matchesSearch && matchesFilter));
    });

    // Update Sidebar Counts & Visibility
    document.getElementById('count-all').textContent = counts.all;
    document.getElementById('count-notes').textContent = counts.notes;
    document.getElementById('count-slides').textContent = counts.slides;
    document.getElementById('count-exercises').textContent = counts.exercises;
    document.getElementById('count-exercises-no-solutions').textContent = counts['exercises-no-solutions'];
    document.getElementById('count-blueprint').textContent = counts.blueprint;
    document.getElementById('count-teachers-method').textContent = counts['teachers-method'];

    // Helper to toggle sidebar item visibility
    const toggleItem = (id, count) => {
        const el = document.getElementById(id)?.closest('.sidebar-item');
        if (el) el.style.display = count > 0 ? 'flex' : 'none';
    };

    toggleItem('count-all', counts.all);
    toggleItem('count-notes', counts.notes);
    toggleItem('count-slides', counts.slides);
    toggleItem('count-exercises', counts.exercises);
    toggleItem('count-exercises-no-solutions', counts['exercises-no-solutions']);
    toggleItem('count-blueprint', counts.blueprint);
    toggleItem('count-teachers-method', counts['teachers-method']);

    // Update lecture counts and visibility
    if (pdfStructure.lectures) {
        pdfStructure.lectures.forEach(lectureId => {
            const count = lectureCounts[lectureId] || 0;
            const countEl = document.getElementById(`count-${lectureId}`);
            if (countEl) {
                countEl.textContent = count;
                toggleItem(`count-${lectureId}`, count);
            }
        });
    }

    // Debounced URL update for search (300ms delay to avoid spamming history)
    if (searchUrlUpdateTimeout) {
        clearTimeout(searchUrlUpdateTimeout);
    }
    searchUrlUpdateTimeout = setTimeout(() => {
        updateFilterURL(true);
    }, 300);
}

// Filter main files with option to skip URL update (used when restoring from URL)
function filterMainFilesInternal(updateUrl = true) {
    const searchTerm = document.getElementById('main-search').value.toLowerCase();
    const rows = document.querySelectorAll('.file-list tbody tr');

    // Reset counts if search is empty
    if (!searchTerm) {
        updateCounts();
        document.querySelectorAll('.sidebar-item').forEach(item => item.style.display = 'flex');

        // Re-apply current category filter visibility
        rows.forEach(row => {
            const fileType = row.dataset.fileType;
            const lectureId = row.dataset.lectureId;

            if (currentFilter === 'all') {
                row.classList.remove('hidden');
            } else if (currentFilter === 'notes' || currentFilter === 'slides' || currentFilter === 'exercises' || currentFilter === 'exercises-no-solutions' || currentFilter === 'blueprint' || currentFilter === 'teachers-method') {
                row.classList.toggle('hidden', fileType !== currentFilter);
            } else if (currentFilter.startsWith('lecture-')) {
                row.classList.toggle('hidden', lectureId !== currentFilter);
            }
        });

        if (updateUrl) {
            updateFilterURL(true);
        }
        return;
    }

    // Track counts for search results
    const counts = {
        all: 0,
        notes: 0,
        slides: 0,
        exercises: 0,
        'exercises-no-solutions': 0,
        blueprint: 0,
        'teachers-method': 0
    };
    const lectureCounts = {};

    rows.forEach(row => {
        const searchText = row.dataset.searchText;
        const matchesSearch = searchText.includes(searchTerm);
        const fileType = row.dataset.fileType;
        const lecture = row.dataset.lecture;

        if (matchesSearch) {
            counts.all++;
            if (counts[fileType] !== undefined) counts[fileType]++;

            if (lecture) {
                lectureCounts[lecture] = (lectureCounts[lecture] || 0) + 1;
            }
        }

        // Apply both filter and search for the file list view
        let matchesFilter = false;
        if (currentFilter === 'all') {
            matchesFilter = true;
        } else if (currentFilter === 'notes' || currentFilter === 'slides' || currentFilter === 'exercises' || currentFilter === 'exercises-no-solutions' || currentFilter === 'blueprint' || currentFilter === 'teachers-method') {
            matchesFilter = fileType === currentFilter;
        } else if (currentFilter.startsWith('lecture-')) {
            matchesFilter = lecture === currentFilter;
        }

        row.classList.toggle('hidden', !(matchesSearch && matchesFilter));
    });

    // Update Sidebar Counts & Visibility
    document.getElementById('count-all').textContent = counts.all;
    document.getElementById('count-notes').textContent = counts.notes;
    document.getElementById('count-slides').textContent = counts.slides;
    document.getElementById('count-exercises').textContent = counts.exercises;
    document.getElementById('count-exercises-no-solutions').textContent = counts['exercises-no-solutions'];
    document.getElementById('count-blueprint').textContent = counts.blueprint;
    document.getElementById('count-teachers-method').textContent = counts['teachers-method'];

    // Helper to toggle sidebar item visibility
    const toggleItem = (id, count) => {
        const el = document.getElementById(id)?.closest('.sidebar-item');
        if (el) el.style.display = count > 0 ? 'flex' : 'none';
    };

    toggleItem('count-all', counts.all);
    toggleItem('count-notes', counts.notes);
    toggleItem('count-slides', counts.slides);
    toggleItem('count-exercises', counts.exercises);
    toggleItem('count-exercises-no-solutions', counts['exercises-no-solutions']);
    toggleItem('count-blueprint', counts.blueprint);
    toggleItem('count-teachers-method', counts['teachers-method']);

    // Update lecture counts and visibility
    if (pdfStructure.lectures) {
        pdfStructure.lectures.forEach(lectureId => {
            const count = lectureCounts[lectureId] || 0;
            const countEl = document.getElementById(`count-${lectureId}`);
            if (countEl) {
                countEl.textContent = count;
                toggleItem(`count-${lectureId}`, count);
            }
        });
    }

    if (updateUrl) {
        updateFilterURL(true);
    }
}

// Toggle path expansion in file list
function togglePathExpand(icon) {
    const pathSpan = icon.parentElement;
    const fullPath = pathSpan.getAttribute('data-full-path');
    const isExpanded = pathSpan.classList.contains('expanded');

    if (isExpanded) {
        // Collapse - show short path
        const pathParts = fullPath.split('/');
        const shortPath = pathParts.length > 2
            ? `.../${pathParts[pathParts.length - 1]}`
            : fullPath;
        pathSpan.childNodes[0].textContent = shortPath + ' ';
        pathSpan.classList.remove('expanded');
        icon.classList.remove('fa-folder-open');
        icon.classList.add('fa-folder');
    } else {
        // Expand - show full path
        pathSpan.childNodes[0].textContent = fullPath + ' ';
        pathSpan.classList.add('expanded');
        icon.classList.remove('fa-folder');
        icon.classList.add('fa-folder-open');
    }
}

// Open PDF in modal (public function with URL update)
function openPDF(title, path, category = '') {
    openPDFInternal(title, path, category, true);
}

// Internal function to open PDF (with optional URL update)
function openPDFInternal(title, path, category = '', updateUrl = true) {
    // Clear any pending search URL update to prevent race condition
    if (searchUrlUpdateTimeout) {
        clearTimeout(searchUrlUpdateTimeout);
        searchUrlUpdateTimeout = null;
    }

    // Safety: if updateUrl is true (user action), ensure isRestoringState is false
    if (updateUrl) {
        isRestoringState = false;
    }

    const modal = document.getElementById('pdf-modal');
    const viewer = document.getElementById('pdf-viewer-left');
    const modalTitle = document.getElementById('modal-title');
    const modalSubtitle = document.getElementById('modal-subtitle');

    // Close TeX editor if open (important: must close before opening PDF)
    if (typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen && typeof closeTexEditor === 'function') {
        closeTexEditor();
    }

    // Check if same PDF is already loaded (to preserve scroll position)
    const currentSrc = viewer.src;
    const newSrcWithoutFragment = path.split('#')[0];
    const currentSrcWithoutFragment = currentSrc ? currentSrc.split('#')[0] : '';
    const isSamePDF = currentSrcWithoutFragment.endsWith(newSrcWithoutFragment);

    currentLeftPDF = { title, path, category };

    modalTitle.textContent = title;
    modalSubtitle.textContent = category;

    // Only reload iframe if it's a different PDF
    // This preserves scroll position when reopening from sidebar
    if (!isSamePDF) {
        viewer.src = path;
    }

    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';

    // Reset split view if it was active
    if (isSplitView) {
        closeSplitView();
    }

    // Save to history (not split view yet)
    if (!isRestoringState) {
        saveToHistory(title, path, category, false);
    }

    // Update URL and push history state for back button
    if (updateUrl && !isRestoringState) {
        updateURL(true);
    }

    // Setup click handlers to track which pane is focused
    setTimeout(() => {
        setupPaneFocusTracking();
    }, 500);
}

// Setup focus tracking for panes
function setupPaneFocusTracking() {
    const leftViewer = document.getElementById('pdf-viewer-left');
    const rightViewer = document.getElementById('pdf-viewer-right');

    if (leftViewer) {
        leftViewer.addEventListener('click', () => {
            lastFocusedPane = 'left';
            leftViewer.focus();
        });
    }

    if (rightViewer && isSplitView) {
        rightViewer.addEventListener('click', () => {
            lastFocusedPane = 'right';
            rightViewer.focus();
        });
    }
}

// Trigger browser's native find dialog
function triggerBrowserFind(pane) {
    const iframe = document.getElementById(`pdf-viewer-${pane}`);

    // Focus the iframe first
    try {
        iframe.focus();
        iframe.contentWindow.focus();
        lastFocusedPane = pane;
    } catch (e) {
        console.log('Could not focus iframe');
    }

    // Show instruction to user
    showSearchInstruction(pane);

    // Try to trigger native find (works in some browsers)
    setTimeout(() => {
        try {
            // This might work in some contexts
            if (document.execCommand) {
                document.execCommand('find', false, '');
            }
        } catch (e) {
            // Fallback - user needs to press Ctrl+F manually
            console.log('Use Ctrl+F / Cmd+F to search');
        }
    }, 100);
}

// Show search instruction
function showSearchInstruction(pane) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcut = isMac ? 'Cmd+F' : 'Ctrl+F';

    // Create temporary tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        backdrop-filter: blur(20px);
        color: white;
        padding: 20px 30px;
        border-radius: 16px;
        font-size: 16px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        animation: fadeInOut 2.5s ease;
    `;
    tooltip.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 32px; margin-bottom: 10px;"><i class="fas fa-search"></i></div>
            <div>Press <strong>${shortcut}</strong> to search in this PDF</div>
            <div style="font-size: 13px; margin-top: 8px; opacity: 0.8;">Make sure the PDF is focused (click on it first)</div>
        </div>
    `;

    // Add fadeInOut animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeInOut {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
            15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(tooltip);

    setTimeout(() => {
        tooltip.remove();
        style.remove();
    }, 2500);
}

// Handle keyboard shortcuts for search
document.addEventListener('keydown', (e) => {
    // Check if Ctrl+F or Cmd+F is pressed
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        // If a PDF is open, show which pane will be searched
        const modal = document.getElementById('pdf-modal');
        if (modal.style.display === 'block') {
            // Let the browser handle it, but show which PDF is focused
            const pane = lastFocusedPane;
            const iframe = document.getElementById(`pdf-viewer-${pane}`);

            // Make sure the correct iframe is focused
            setTimeout(() => {
                try {
                    iframe.focus();
                    iframe.contentWindow.focus();
                } catch (err) { }
            }, 10);
        }
    }
});

// Toggle split view
function toggleSplitView() {
    const selector = document.getElementById('pdf-selector');
    const splitBtn = document.getElementById('split-btn');
    const replacePdfBtn = document.getElementById('replace-pdf-btn');

    // Close replace PDF mode if it's open
    if (selector.dataset.mode === 'replace') {
        selector.classList.remove('visible');
        replacePdfBtn.classList.remove('active');
        delete selector.dataset.mode;
    }

    if (selector.classList.contains('visible')) {
        selector.classList.remove('visible');
        splitBtn.classList.remove('active');
    } else {
        selector.classList.add('visible');
        splitBtn.classList.add('active');
        selector.dataset.mode = 'split';
        selector.dataset.mode = 'split';
        populatePDFSelector();
    }
}

// Toggle replace PDF mode
function toggleReplacePDF() {
    const selector = document.getElementById('pdf-selector');
    const replacePdfBtn = document.getElementById('replace-pdf-btn');
    const splitBtn = document.getElementById('split-btn');

    // Close split view mode if it's open
    if (selector.dataset.mode === 'split') {
        selector.classList.remove('visible');
        splitBtn.classList.remove('active');
        delete selector.dataset.mode;
    }

    if (selector.classList.contains('visible') && selector.dataset.mode === 'replace') {
        selector.classList.remove('visible');
        replacePdfBtn.classList.remove('active');
        delete selector.dataset.mode;
    } else {
        selector.classList.add('visible');
        replacePdfBtn.classList.add('active');
        selector.dataset.mode = 'replace';
        populatePDFSelectorForReplace();
    }
}

// Populate PDF selector
function populatePDFSelector() {
    const container = document.getElementById('selector-content');
    const selectorHeader = document.querySelector('.selector-header h3');
    const quickDuplicateBtn = document.getElementById('quick-duplicate-btn');

    // Update header for split view mode
    if (selectorHeader) selectorHeader.textContent = 'Select PDF for Split View';
    if (quickDuplicateBtn) quickDuplicateBtn.style.display = 'block';

    container.innerHTML = '';

    // Helper to check if file is PDF (not .tex)
    const isPdf = (pdf) => pdf.fileType !== 'tex' && !pdf.path.toLowerCase().endsWith('.tex');

    // Add lecture notes
    if (pdfStructure.notes) {
        for (const [lectureName, pdfs] of Object.entries(pdfStructure.notes)) {
            const pdfOnly = Array.isArray(pdfs) ? pdfs.filter(isPdf) : [];
            if (pdfOnly.length === 0) continue;

            const group = document.createElement('div');
            group.className = 'selector-group';

            const groupTitle = document.createElement('div');
            groupTitle.className = 'selector-group-title';
            groupTitle.textContent = lectureName;
            group.appendChild(groupTitle);

            pdfOnly.forEach(pdf => {
                const item = createSelectorItem(pdf.title, pdf.path, lectureName);
                group.appendChild(item);
            });

            container.appendChild(group);
        }
    }

    // Add slides (PDF only)
    const slidesOnly = pdfStructure.slides?.filter(isPdf) || [];
    if (slidesOnly.length > 0) {
        const slidesGroup = document.createElement('div');
        slidesGroup.className = 'selector-group';
        const slidesTitle = document.createElement('div');
        slidesTitle.className = 'selector-group-title';
        slidesTitle.textContent = 'Lecture Slides';
        slidesGroup.appendChild(slidesTitle);

        slidesOnly.forEach(pdf => {
            const item = createSelectorItem(pdf.title, pdf.path, 'Lecture Slides');
            slidesGroup.appendChild(item);
        });
        container.appendChild(slidesGroup);
    }

    // Add exercises (PDF only)
    const exercisesOnly = pdfStructure.exercises?.filter(isPdf) || [];
    if (exercisesOnly.length > 0) {
        const exercisesGroup = document.createElement('div');
        exercisesGroup.className = 'selector-group';
        const exercisesTitle = document.createElement('div');
        exercisesTitle.className = 'selector-group-title';
        exercisesTitle.textContent = 'Exercises';
        exercisesGroup.appendChild(exercisesTitle);

        exercisesOnly.forEach(pdf => {
            const item = createSelectorItem(pdf.title, pdf.path, 'Exercises');
            exercisesGroup.appendChild(item);
        });
        container.appendChild(exercisesGroup);
    }

    // Add exercises without solutions (PDF only)
    const exercisesNoSolOnly = pdfStructure.exercisesNoSolutions?.filter(isPdf) || [];
    if (exercisesNoSolOnly.length > 0) {
        const exercisesNoSolutionsGroup = document.createElement('div');
        exercisesNoSolutionsGroup.className = 'selector-group';
        const exercisesNoSolutionsTitle = document.createElement('div');
        exercisesNoSolutionsTitle.className = 'selector-group-title';
        exercisesNoSolutionsTitle.textContent = 'Exercises (No Solutions)';
        exercisesNoSolutionsGroup.appendChild(exercisesNoSolutionsTitle);

        exercisesNoSolOnly.forEach(pdf => {
            const item = createSelectorItem(pdf.title, pdf.path, 'Exercises (No Solutions)');
            exercisesNoSolutionsGroup.appendChild(item);
        });
        container.appendChild(exercisesNoSolutionsGroup);
    }

    // Add blueprint (PDF only)
    const blueprintOnly = pdfStructure.blueprint?.filter(isPdf) || [];
    if (blueprintOnly.length > 0) {
        const blueprintGroup = document.createElement('div');
        blueprintGroup.className = 'selector-group';
        const blueprintTitle = document.createElement('div');
        blueprintTitle.className = 'selector-group-title';
        blueprintTitle.textContent = 'Blueprint';
        blueprintGroup.appendChild(blueprintTitle);

        blueprintOnly.forEach(pdf => {
            const item = createSelectorItem(pdf.title, pdf.path, 'Blueprint');
            blueprintGroup.appendChild(item);
        });
        container.appendChild(blueprintGroup);
    }

    // Add teachers method (PDF only)
    const teachersMethodOnly = pdfStructure.teachersMethod?.filter(isPdf) || [];
    if (teachersMethodOnly.length > 0) {
        const teachersMethodGroup = document.createElement('div');
        teachersMethodGroup.className = 'selector-group';
        const teachersMethodTitle = document.createElement('div');
        teachersMethodTitle.className = 'selector-group-title';
        teachersMethodTitle.textContent = 'Teachers Method';
        teachersMethodGroup.appendChild(teachersMethodTitle);

        teachersMethodOnly.forEach(pdf => {
            const item = createSelectorItem(pdf.title, pdf.path, 'Teachers Method');
            teachersMethodGroup.appendChild(item);
        });
        container.appendChild(teachersMethodGroup);
    }

    // Add custom categories (PDF only)
    if (pdfStructure.customCategories) {
        for (const [categoryName, pdfs] of Object.entries(pdfStructure.customCategories)) {
            const pdfOnly = Array.isArray(pdfs) ? pdfs.filter(isPdf) : [];
            if (pdfOnly.length > 0) {
                const customGroup = document.createElement('div');
                customGroup.className = 'selector-group';
                const customTitle = document.createElement('div');
                customTitle.className = 'selector-group-title';
                customTitle.textContent = formatCategoryName(categoryName);
                customGroup.appendChild(customTitle);

                pdfOnly.forEach(pdf => {
                    const item = createSelectorItem(pdf.title, pdf.path, categoryName);
                    customGroup.appendChild(item);
                });
                container.appendChild(customGroup);
            }
        }
    }
}

// Populate PDF selector for replace mode
function populatePDFSelectorForReplace() {
    const container = document.getElementById('selector-content');
    const selectorHeader = document.querySelector('.selector-header h3');
    const quickDuplicateBtn = document.getElementById('quick-duplicate-btn');

    // Update header for replace mode
    if (selectorHeader) selectorHeader.textContent = 'Replace Current PDF';
    if (quickDuplicateBtn) quickDuplicateBtn.style.display = 'none';

    container.innerHTML = '';

    // Add lecture notes
    if (pdfStructure.notes) {
        for (const [lectureName, pdfs] of Object.entries(pdfStructure.notes)) {
            const group = document.createElement('div');
            group.className = 'selector-group';

            const groupTitle = document.createElement('div');
            groupTitle.className = 'selector-group-title';
            groupTitle.textContent = lectureName;
            group.appendChild(groupTitle);

            if (Array.isArray(pdfs)) {
                pdfs.forEach(pdf => {
                    const item = createSelectorItemForReplace(pdf.title, pdf.path, lectureName);
                    group.appendChild(item);
                });
            }

            container.appendChild(group);
        }
    }

    // Add slides
    if (pdfStructure.slides && Array.isArray(pdfStructure.slides) && pdfStructure.slides.length > 0) {
        const slidesGroup = document.createElement('div');
        slidesGroup.className = 'selector-group';
        const slidesTitle = document.createElement('div');
        slidesTitle.className = 'selector-group-title';
        slidesTitle.textContent = 'Lecture Slides';
        slidesGroup.appendChild(slidesTitle);

        pdfStructure.slides.forEach(pdf => {
            const item = createSelectorItemForReplace(pdf.title, pdf.path, 'Lecture Slides');
            slidesGroup.appendChild(item);
        });
        container.appendChild(slidesGroup);
    }

    // Add exercises
    if (pdfStructure.exercises && Array.isArray(pdfStructure.exercises) && pdfStructure.exercises.length > 0) {
        const exercisesGroup = document.createElement('div');
        exercisesGroup.className = 'selector-group';
        const exercisesTitle = document.createElement('div');
        exercisesTitle.className = 'selector-group-title';
        exercisesTitle.textContent = 'Exercises';
        exercisesGroup.appendChild(exercisesTitle);

        pdfStructure.exercises.forEach(pdf => {
            const item = createSelectorItemForReplace(pdf.title, pdf.path, 'Exercises');
            exercisesGroup.appendChild(item);
        });
        container.appendChild(exercisesGroup);
    }

    // Add exercises without solutions
    if (pdfStructure.exercisesNoSolutions && Array.isArray(pdfStructure.exercisesNoSolutions) && pdfStructure.exercisesNoSolutions.length > 0) {
        const exercisesNoSolutionsGroup = document.createElement('div');
        exercisesNoSolutionsGroup.className = 'selector-group';
        const exercisesNoSolutionsTitle = document.createElement('div');
        exercisesNoSolutionsTitle.className = 'selector-group-title';
        exercisesNoSolutionsTitle.textContent = 'Exercises (No Solutions)';
        exercisesNoSolutionsGroup.appendChild(exercisesNoSolutionsTitle);

        pdfStructure.exercisesNoSolutions.forEach(pdf => {
            const item = createSelectorItemForReplace(pdf.title, pdf.path, 'Exercises (No Solutions)');
            exercisesNoSolutionsGroup.appendChild(item);
        });
        container.appendChild(exercisesNoSolutionsGroup);
    }

    // Add blueprint
    if (pdfStructure.blueprint && Array.isArray(pdfStructure.blueprint) && pdfStructure.blueprint.length > 0) {
        const blueprintGroup = document.createElement('div');
        blueprintGroup.className = 'selector-group';
        const blueprintTitle = document.createElement('div');
        blueprintTitle.className = 'selector-group-title';
        blueprintTitle.textContent = 'Blueprint';
        blueprintGroup.appendChild(blueprintTitle);

        pdfStructure.blueprint.forEach(pdf => {
            const item = createSelectorItemForReplace(pdf.title, pdf.path, 'Blueprint');
            blueprintGroup.appendChild(item);
        });
        container.appendChild(blueprintGroup);
    }

    // Add teachers method
    if (pdfStructure.teachersMethod && Array.isArray(pdfStructure.teachersMethod) && pdfStructure.teachersMethod.length > 0) {
        const teachersMethodGroup = document.createElement('div');
        teachersMethodGroup.className = 'selector-group';
        const teachersMethodTitle = document.createElement('div');
        teachersMethodTitle.className = 'selector-group-title';
        teachersMethodTitle.textContent = 'Teachers Method';
        teachersMethodGroup.appendChild(teachersMethodTitle);

        pdfStructure.teachersMethod.forEach(pdf => {
            const item = createSelectorItemForReplace(pdf.title, pdf.path, 'Teachers Method');
            teachersMethodGroup.appendChild(item);
        });
        container.appendChild(teachersMethodGroup);
    }

    // Add custom categories
    if (pdfStructure.customCategories) {
        for (const [categoryName, pdfs] of Object.entries(pdfStructure.customCategories)) {
            if (Array.isArray(pdfs) && pdfs.length > 0) {
                const customGroup = document.createElement('div');
                customGroup.className = 'selector-group';
                const customTitle = document.createElement('div');
                customTitle.className = 'selector-group-title';
                customTitle.textContent = formatCategoryName(categoryName);
                customGroup.appendChild(customTitle);

                pdfs.forEach(pdf => {
                    const item = createSelectorItemForReplace(pdf.title, pdf.path, categoryName);
                    customGroup.appendChild(item);
                });
                container.appendChild(customGroup);
            }
        }
    }
}

// Create selector item
function createSelectorItem(title, path, category) {
    const item = document.createElement('div');
    item.className = 'selector-item';
    item.dataset.title = title.toLowerCase();
    item.dataset.path = path.toLowerCase();
    item.dataset.category = category.toLowerCase();
    item.onclick = () => selectPDFForSplit(title, path, category);

    item.innerHTML = `
        <div class="selector-item-title">${title}</div>
        <div class="selector-item-path">${path}</div>
    `;

    return item;
}

// Create selector item for replace mode
function createSelectorItemForReplace(title, path, category) {
    const item = document.createElement('div');
    item.className = 'selector-item';
    item.dataset.title = title.toLowerCase();
    item.dataset.path = path.toLowerCase();
    item.dataset.category = category.toLowerCase();
    item.onclick = () => replacePDF(title, path, category);

    item.innerHTML = `
        <div class="selector-item-title">${title}</div>
        <div class="selector-item-path">${path}</div>
    `;

    return item;
}

// Replace current PDF
function replacePDF(title, path, category) {
    const viewer = document.getElementById('pdf-viewer-left');
    const modalTitle = document.getElementById('modal-title');
    const modalSubtitle = document.getElementById('modal-subtitle');
    const paneLeftTitle = document.getElementById('pane-left-title');

    // If in split view, also update the left pane title
    if (isSplitView) {
        paneLeftTitle.textContent = title;
    }

    // Update current PDF
    currentLeftPDF = { title, path, category };

    // Update UI
    modalTitle.textContent = title;
    modalSubtitle.textContent = category;
    viewer.src = path;

    // Save to history
    if (!isRestoringState) {
        saveToHistory(title, path, category, isSplitView);
    }

    // Update URL
    if (!isRestoringState) {
        updateURL(true);
    }

    // Close selector
    toggleReplacePDF();

    // Show notification
    showNotification(`Switched to: ${title}`, 2000);
}

// Filter selector PDFs
function filterSelectorPDFs() {
    const searchBox = document.getElementById('selector-search');
    const searchTerm = searchBox.value.toLowerCase();
    const groups = document.querySelectorAll('.selector-group');

    groups.forEach(group => {
        const items = group.querySelectorAll('.selector-item');
        let hasVisibleItems = false;

        items.forEach(item => {
            const title = item.dataset.title;
            const path = item.dataset.path;
            const category = item.dataset.category;

            if (title.includes(searchTerm) || path.includes(searchTerm) || category.includes(searchTerm)) {
                item.classList.remove('hidden');
                hasVisibleItems = true;
            } else {
                item.classList.add('hidden');
            }
        });

        // Hide the group if no items are visible
        if (hasVisibleItems) {
            group.style.display = 'block';
        } else {
            group.style.display = 'none';
        }
    });
}

// Select PDF for split view (public function with URL update)
function selectPDFForSplit(title, path, category, updateUrl = true) {
    const paneRight = document.getElementById('pane-right');
    const paneLeft = document.getElementById('pane-left');
    const divider = document.getElementById('divider');
    const viewerRight = document.getElementById('pdf-viewer-right');
    const paneRightTitle = document.getElementById('pane-right-title');
    const paneRightHeader = document.getElementById('pane-right-header');
    const paneLeftHeader = document.getElementById('pane-left-header');
    const paneLeftTitle = document.getElementById('pane-left-title');

    // Store right PDF info
    currentRightPDF = { title, path, category };

    // Show split view
    paneRight.style.display = 'flex';
    paneLeft.classList.add('split');
    paneRight.classList.add('split');

    // Show resize controls in sidebar (collapsed by default)
    const resizeControls = document.getElementById('split-resize-controls');
    const resizeButtons = document.getElementById('resize-buttons-container');
    resizeControls.style.display = 'block';
    resizeButtons.style.display = 'none';
    resizeControls.classList.remove('expanded');

    // Show pane headers
    paneLeftHeader.style.display = 'flex';
    paneRightHeader.style.display = 'flex';

    // Set titles
    paneLeftTitle.textContent = currentLeftPDF.title;
    paneRightTitle.textContent = title;

    // Load PDF
    viewerRight.src = path;

    isSplitView = true;
    leftPaneHidden = false;
    rightPaneHidden = false;

    // Load saved split ratio
    loadSplitRatio();

    // Hide show buttons
    document.getElementById('show-left-btn').style.display = 'none';
    document.getElementById('show-right-btn').style.display = 'none';

    // Save split companion to localStorage
    if (currentLeftPDF.path && path) {
        saveSplitCompanion(currentLeftPDF.path, path);
    }

    // Update history to mark as split view
    if (!isRestoringState) {
        saveToHistory(currentLeftPDF.title, currentLeftPDF.path, currentLeftPDF.category, true);
    }

    // Update URL if requested
    if (updateUrl && !isRestoringState) {
        updateURL(true);
    }

    // Setup focus tracking
    setTimeout(() => {
        setupPaneFocusTracking();
    }, 500);

    // Hide selector
    if (updateUrl) {
        toggleSplitView();
    }
}

// Hide left pane
function hideLeftPane() {
    const paneLeft = document.getElementById('pane-left');
    const paneRight = document.getElementById('pane-right');
    const divider = document.getElementById('divider');
    const showLeftBtn = document.getElementById('show-left-btn');

    paneLeft.style.display = 'none';
    divider.style.display = 'none';
    paneRight.classList.remove('split');
    paneRight.style.flex = '1';

    leftPaneHidden = true;
    showLeftBtn.style.display = 'flex';
}

// Hide right pane
function hideRightPane() {
    const paneRight = document.getElementById('pane-right');
    const paneLeft = document.getElementById('pane-left');
    const divider = document.getElementById('divider');
    const showRightBtn = document.getElementById('show-right-btn');

    paneRight.style.display = 'none';
    divider.style.display = 'none';
    paneLeft.classList.remove('split');
    paneLeft.style.flex = '1';

    rightPaneHidden = true;
    showRightBtn.style.display = 'flex';
}

// Show left pane
function showLeftPane() {
    const paneLeft = document.getElementById('pane-left');
    const paneRight = document.getElementById('pane-right');
    const divider = document.getElementById('divider');
    const showLeftBtn = document.getElementById('show-left-btn');

    paneLeft.style.display = 'flex';
    divider.style.display = 'block';
    paneLeft.classList.add('split');
    paneRight.classList.add('split');
    paneLeft.style.flex = '0 0 50%';
    paneRight.style.flex = '0 0 50%';

    leftPaneHidden = false;
    showLeftBtn.style.display = 'none';
}

// Show right pane
function showRightPane() {
    const paneRight = document.getElementById('pane-right');
    const paneLeft = document.getElementById('pane-left');
    const divider = document.getElementById('divider');
    const showRightBtn = document.getElementById('show-right-btn');

    paneRight.style.display = 'flex';
    divider.style.display = 'block';
    paneLeft.classList.add('split');
    paneRight.classList.add('split');
    paneLeft.style.flex = '0 0 50%';
    paneRight.style.flex = '0 0 50%';

    rightPaneHidden = false;
    showRightBtn.style.display = 'none';
}

// Duplicate current PDF (quick button)
function duplicateCurrentPDFQuick() {
    if (currentLeftPDF.path) {
        selectPDFForSplit(
            currentLeftPDF.title,
            currentLeftPDF.path,
            currentLeftPDF.category || ''
        );
    }
}

// Close split view completely
function closeSplitView() {
    const paneRight = document.getElementById('pane-right');
    const paneLeft = document.getElementById('pane-left');
    const divider = document.getElementById('divider');
    const viewerRight = document.getElementById('pdf-viewer-right');
    const paneLeftHeader = document.getElementById('pane-left-header');
    const paneRightHeader = document.getElementById('pane-right-header');
    const showLeftBtn = document.getElementById('show-left-btn');
    const showRightBtn = document.getElementById('show-right-btn');

    // Show left pane if it was hidden
    if (leftPaneHidden) {
        paneLeft.style.display = 'flex';
    }

    // Hide split view
    paneRight.style.display = 'none';
    paneLeft.classList.remove('split');
    paneRight.classList.remove('split');
    paneLeft.style.flex = '1';

    // Hide resize controls
    document.getElementById('split-resize-controls').style.display = 'none';

    // Hide pane headers
    paneLeftHeader.style.display = 'none';
    paneRightHeader.style.display = 'none';

    // Clear right viewer
    viewerRight.src = '';

    // Reset states
    isSplitView = false;
    leftPaneHidden = false;
    rightPaneHidden = false;
    showLeftBtn.style.display = 'none';
    showRightBtn.style.display = 'none';

    // Clear right PDF reference
    currentRightPDF = { title: '', path: '', category: '' };

    // Ensure selector is hidden
    const selector = document.getElementById('pdf-selector');
    const splitBtn = document.getElementById('split-btn');

    selector.classList.remove('visible');
    splitBtn.classList.remove('active');
}

// Close PDF modal (public function with URL update)
function closePDF() {
    // Close tex editor first if open
    if (typeof closeTexEditor === 'function' && typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen) {
        if (!closeTexEditor()) {
            return; // User cancelled (unsaved changes)
        }
    }

    closePDFInternal();

    // Update URL to home with current filter/search state preserved
    if (!isRestoringState) {
        updateFilterURL(true);
    }
}

// Internal close function (without URL update)
function closePDFInternal() {
    const modal = document.getElementById('pdf-modal');
    const viewerLeft = document.getElementById('pdf-viewer-left');
    const viewerRight = document.getElementById('pdf-viewer-right');
    const showLeftBtn = document.getElementById('show-left-btn');
    const showRightBtn = document.getElementById('show-right-btn');

    modal.style.display = 'none';
    viewerLeft.src = '';
    viewerRight.src = '';
    document.body.style.overflow = 'auto';

    // Reset split view
    if (isSplitView) {
        closeSplitView();
    }

    // Hide show buttons
    showLeftBtn.style.display = 'none';
    showRightBtn.style.display = 'none';

    // Reset last focused pane
    lastFocusedPane = 'left';

    // Clear current PDFs
    currentLeftPDF = { title: '', path: '', category: '' };
    currentRightPDF = { title: '', path: '', category: '' };
}

// Load saved split ratio from database
async function loadSplitRatio() {
    const savedRatio = await getPreference('splitViewRatio');
    if (savedRatio) {
        const ratio = parseFloat(savedRatio);
        applySplitRatio(ratio);
    }
}

// Apply split ratio to panes
function applySplitRatio(percentage) {
    const paneLeft = document.getElementById('pane-left');
    const paneRight = document.getElementById('pane-right');
    paneLeft.style.flex = `0 0 ${percentage}%`;
    paneRight.style.flex = `0 0 ${100 - percentage}%`;
}

// Toggle resize controls
function toggleResizeControls() {
    const container = document.getElementById('resize-buttons-container');
    const controls = document.getElementById('split-resize-controls');

    if (container.style.display === 'none') {
        container.style.display = 'block';
        controls.classList.add('expanded');
    } else {
        container.style.display = 'none';
        controls.classList.remove('expanded');
    }
}

// Set split ratio from button click
async function setSplitRatio(percentage) {
    applySplitRatio(percentage);
    await setPreference('splitViewRatio', percentage.toString());

    // Update URL with new ratio
    if (!isRestoringState) {
        updateURL(false); // Replace state, don't push
    }
}

// Close modal on ESC key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const deleteModal = document.getElementById('delete-confirm-modal');
        const selector = document.getElementById('pdf-selector');

        // Check if delete confirmation modal is open first
        if (deleteModal && deleteModal.style.display === 'block') {
            closeDeleteConfirmModal();
        } else if (selector.classList.contains('visible')) {
            // Close the appropriate selector based on mode
            if (selector.dataset.mode === 'replace') {
                toggleReplacePDF();
            } else {
                toggleSplitView();
            }
        } else {
            closePDF();
        }
    }
});

// Close modal on background click
document.getElementById('pdf-modal').addEventListener('click', (e) => {
    if (e.target.id === 'pdf-modal') {
        closePDF();
    }
});

// Update history time display periodically
setInterval(() => {
    // Only update if history is visible and has items
    const historyList = document.getElementById('history-list');
    if (historyList && historyList.children.length > 0 && !historyList.querySelector('.history-empty')) {
        updateHistoryDisplay();
    }
}, 60000); // Update every minute

// Open Fast Search from sidebar
function openFastSearchFromSidebar() {
    // Close the PDF selector sidebar
    const selector = document.getElementById('pdf-selector');
    if (selector && selector.classList.contains('visible')) {
        const splitBtn = document.getElementById('split-btn');
        const replacePdfBtn = document.getElementById('replace-pdf-btn');

        selector.classList.remove('visible');
        if (splitBtn) splitBtn.classList.remove('active');
        if (replacePdfBtn) replacePdfBtn.classList.remove('active');
    }

    // Open the Fast Search panel
    if (typeof window.pdfSearchUI !== 'undefined' && window.pdfSearchUI) {
        window.pdfSearchUI.toggleSearchPanel();
    } else {
        console.error('Fast Search not initialized yet');
        alert('Fast Search is loading... Please try again in a moment.');
    }
}

// ============================================================================
// FILE MANAGEMENT
// ============================================================================

let currentManageFile = null;

function openFileManageModal(file, event) {
    currentManageFile = file;

    // Update filename
    document.getElementById('manage-file-name').textContent = file.name;

    // Set filename input (without .pdf extension)
    const filenameWithoutExt = file.name.replace(/\.pdf$/i, '');
    document.getElementById('new-filename').value = filenameWithoutExt;

    // Populate custom categories in dropdown FIRST
    populateCustomCategoriesInDropdown();

    // Set current category - now handles both standard and custom categories
    const category = file.fileType || 'notes';
    const selectElement = document.getElementById('move-category');

    console.log('Opening manage modal:', {
        fileName: file.name,
        filePath: file.path,
        fileType: file.fileType,
        categoryToSelect: category,
        availableOptions: Array.from(selectElement.options).map(opt => opt.value)
    });

    // Try to set the value
    selectElement.value = category;

    // If the value didn't set (option doesn't exist), default to notes
    if (selectElement.value !== category) {
        console.warn(`Category "${category}" not found in dropdown, defaulting to notes`);
        selectElement.value = 'notes';
    }

    console.log('Selected category:', selectElement.value, 'Display:', selectElement.options[selectElement.selectedIndex].text);

    // Set lecture number if it exists
    const lectureInput = document.getElementById('lecture-number');
    if (lectureInput) {
        lectureInput.value = file.lecture || '';
    }

    const popover = document.getElementById('file-popover');
    const overlay = document.getElementById('file-manage-modal');

    // Position popover near the clicked button
    if (event && event.target) {
        const button = event.target.closest('button');
        const buttonRect = button.getBoundingClientRect();
        const popoverWidth = 420;
        const popoverHeight = 250; // estimated

        let left = buttonRect.right + 10;
        let top = buttonRect.top;

        // If would go off right edge, show on left
        if (left + popoverWidth > window.innerWidth - 20) {
            left = buttonRect.left - popoverWidth - 10;
        }

        // If would go off left edge, clamp
        if (left < 20) {
            left = 20;
        }

        // If would go off bottom, adjust up
        if (top + popoverHeight > window.innerHeight - 20) {
            top = window.innerHeight - popoverHeight - 20;
        }

        // If would go off top, clamp
        if (top < 20) {
            top = 20;
        }

        popover.style.left = left + 'px';
        popover.style.top = top + 'px';
    }

    overlay.style.display = 'block';
}

function closeFileManageModal() {
    document.getElementById('file-manage-modal').style.display = 'none';
    currentManageFile = null;
}

// Helper function to format file size
function formatFileSize(bytes) {
    if (!bytes) return '--';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to get category display name
function getCategoryDisplayName(fileType) {
    const categoryNames = {
        'notes': 'Lecture Notes',
        'slides': 'Lecture Slides',
        'exercises': 'Exercises',
        'exercises-no-solutions': 'Exercises (No Sol)',
        'blueprint': 'Blueprint',
        'teachers-method': 'Teachers Method'
    };

    // Check if it's a custom category
    const customCat = customCategories.find(cat => cat.id === fileType);
    if (customCat) {
        return customCat.name;
    }

    return categoryNames[fileType] || fileType;
}

async function moveFile() {
    if (!currentManageFile) return;

    const newCategory = document.getElementById('move-category').value;
    let newFilename = document.getElementById('new-filename').value.trim();
    const lectureNumber = document.getElementById('lecture-number').value;

    console.log('Starting moveFile with:', {
        currentFile: currentManageFile.path,
        newCategory,
        newFilename,
        lectureNumber
    });

    if (!newFilename) {
        showNotification('Please enter a filename', 3000);
        return;
    }

    // Auto-append .pdf if not present
    if (!newFilename.endsWith('.pdf')) {
        newFilename = newFilename + '.pdf';
    }

    // Handle lecture number: Replace "lecture" with "lec" and format properly
    if (lectureNumber) {
        const lecNum = parseInt(lectureNumber);
        if (!isNaN(lecNum)) {
            // Remove .pdf extension for processing
            let baseName = newFilename.replace(/\.pdf$/i, '');

            // Remove all lecture/exercise indicators and numbers
            baseName = baseName
                .replace(/^lec[- _]?\d*[- _]?/i, '')
                .replace(/^lecture[- _]?\d*[- _]?/i, '')
                .replace(/^(?:exercise|ex)[- _]?\d*[- _]?/i, '')
                .replace(/^\d+[- _]+/, '')
                .replace(/[- _]+/g, '-')
                .replace(/^-+|-+$/g, '');

            // Capitalize "Exercise" if it appears in the filename
            baseName = baseName.replace(/\bexercise\b/gi, 'Exercise');

            // Construct final name: lec-{num}-{cleaned-name}.pdf
            newFilename = `lec-${lecNum}-${baseName}.pdf`;
        }
    } else {
        // Even without lecture number, replace "lecture" with "lec"
        newFilename = newFilename.replace(/lecture[- _]?(\d+)/gi, 'lec-$1');
    }

    // Extract subject code from current path
    const pathParts = currentManageFile.path.split('/');
    const subjectCode = pathParts[1]; // subjects/MACHINE-INT/...

    // Build new path - ensure category is the folder name (e.g., 'dictionary', not 'Dictionary')
    const newPath = `subjects/${subjectCode}/${newCategory}/${newFilename}`;

    // Check if anything actually changed
    const oldPath = currentManageFile.path;
    const oldCategory = oldPath.split('/')[2]; // Extract category folder from path
    const oldFilename = oldPath.split('/').pop();

    console.log('Move file debug:', {
        oldPath,
        newPath,
        oldCategory,
        newCategory,
        oldFilename,
        newFilename,
        fileType: currentManageFile.fileType,
        categoryMatch: oldCategory === newCategory,
        filenameMatch: oldFilename === newFilename,
        pathsEqual: newPath === oldPath
    });

    // Only prevent if BOTH category and filename are the same
    if (oldCategory === newCategory && oldFilename === newFilename) {
        showNotification(`File is already in "${formatCategoryName(newCategory)}" folder with that name`, 4000);
        return;
    }

    try {
        const response = await fetch('/api/file/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                oldPath: currentManageFile.path,
                newPath: newPath,
                newCategory: newCategory
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification('File updated successfully!');
            closeFileManageModal();
            loadPDFStructure(); // Reload file list
        } else {
            showNotification('Failed to update file: ' + result.error, 4000);
        }
    } catch (error) {
        console.error('Move error:', error);
        showNotification('Failed to update file: ' + error.message, 4000);
    }
}

function showDeleteConfirmModal() {
    if (!currentManageFile) return;

    // Set the filename in the confirmation modal
    document.getElementById('delete-file-name').textContent = currentManageFile.name;

    // Show the delete confirmation modal
    document.getElementById('delete-confirm-modal').style.display = 'block';
}

function closeDeleteConfirmModal() {
    document.getElementById('delete-confirm-modal').style.display = 'none';
}

async function deleteFileConfirmed() {
    if (!currentManageFile) return;

    // Close the confirmation modal
    closeDeleteConfirmModal();

    try {
        const response = await fetch('/api/file', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filepath: currentManageFile.path
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification('File deleted successfully');
            closeFileManageModal();
            loadPDFStructure(); // Reload file list
        } else {
            showNotification('Failed to delete file: ' + result.error, 4000);
        }
    } catch (error) {
        console.error('Delete error:', error);
        showNotification('Failed to delete file: ' + error.message, 4000);
    }
}

// ============================================================================
// CUSTOM CATEGORY MANAGEMENT
// ============================================================================

let customCategories = [];
let selectedIcon = 'fa-folder';
let selectedColor = '#007AFF';

function showAddCategoryDialog() {
    document.getElementById('add-category-dialog').style.display = 'block';
    document.getElementById('custom-category-name').value = '';
    selectedIcon = 'fa-folder';
    selectedColor = '#007AFF';

    // Reset icon selection
    document.querySelectorAll('.icon-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.icon === 'fa-folder') {
            btn.classList.add('active');
        }
    });

    // Reset color selection
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.color === '#007AFF') {
            btn.classList.add('active');
        }
    });
}

function closeAddCategoryDialog() {
    document.getElementById('add-category-dialog').style.display = 'none';
}

function selectIcon(iconClass) {
    selectedIcon = iconClass;

    // Update UI
    document.querySelectorAll('.icon-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.icon === iconClass) {
            btn.classList.add('active');
        }
    });
}

function selectColor(color) {
    selectedColor = color;

    // Update UI
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.color === color) {
            btn.classList.add('active');
        }
    });
}

async function createCustomCategory() {
    const categoryName = document.getElementById('custom-category-name').value.trim();

    if (!categoryName) {
        showNotification('Please enter a category name', 3000);
        return;
    }

    // Create category ID from name
    const categoryId = categoryName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    // Check if category already exists
    if (customCategories.some(cat => cat.id === categoryId)) {
        showNotification('Category already exists', 3000);
        return;
    }

    // Get current subject code from the response
    const subjectResponse = await fetch('/api/current-subject');
    const subjectData = await subjectResponse.json();

    if (!subjectData.success || !subjectData.subject) {
        showNotification('Error: No current subject set', 3000);
        return;
    }

    const subjectCode = subjectData.subject.code;

    try {
        // Send to backend with icon and color
        const response = await fetch('/api/custom-categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subjectCode: subjectCode,
                categoryName: categoryName,
                categoryId: categoryId,
                icon: selectedIcon,
                color: selectedColor
            })
        });

        const result = await response.json();

        if (result.success) {
            // Add to local array
            const newCategory = {
                id: categoryId,
                name: categoryName,
                icon: selectedIcon,
                color: selectedColor
            };

            customCategories.push(newCategory);

            // Update UI
            populateCustomCategoriesInDropdown();
            closeAddCategoryDialog();

            // Select the newly created category
            document.getElementById('move-category').value = categoryId;

            showNotification(`Category "${categoryName}" created successfully`, 3000);

            // Reload the file structure to show the new category
            await loadPDFStructure();
        } else {
            showNotification('Failed to create category: ' + result.error, 4000);
        }
    } catch (error) {
        console.error('Error creating category:', error);
        showNotification('Failed to create category: ' + error.message, 4000);
    }
}

function populateCustomCategoriesInDropdown() {
    const select = document.getElementById('move-category');

    // Remove existing custom options
    const customOptions = select.querySelectorAll('option[data-custom="true"]');
    customOptions.forEach(opt => opt.remove());

    // Add custom categories
    customCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        option.dataset.custom = 'true';
        select.appendChild(option);
    });

    // Also update sidebar
    updateCustomCategoriesInSidebar();
}

async function loadCustomCategories() {
    try {
        // Get current subject
        const subjectResponse = await fetch('/api/current-subject');
        const subjectData = await subjectResponse.json();

        if (!subjectData.success || !subjectData.subject) {
            return;
        }

        const subjectCode = subjectData.subject.code;

        // Load custom categories from backend
        const response = await fetch(`/api/custom-categories/${subjectCode}`);
        const data = await response.json();

        if (data.success && data.categories) {
            // Backend now returns full category objects with icon and color
            customCategories = data.categories;
            updateCustomCategoriesInSidebar();
        }
    } catch (error) {
        console.error('Error loading custom categories:', error);
    }
}

function updateCustomCategoriesInSidebar() {
    const sidebarList = document.getElementById('custom-categories-list');
    if (!sidebarList) return;

    // Clear existing custom categories
    sidebarList.innerHTML = '';

    // Add each custom category
    customCategories.forEach(cat => {
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'list-group-item list-group-item-action sidebar-item';
        link.onclick = (e) => {
            e.preventDefault();
            filterByCategory(cat.id);
            return false;
        };

        const iconSpan = document.createElement('span');
        iconSpan.className = 'sidebar-icon';
        const icon = document.createElement('i');
        icon.className = `fas ${cat.icon}`;
        icon.style.color = cat.color;
        iconSpan.appendChild(icon);

        const nameSpan = document.createElement('span');
        nameSpan.textContent = cat.name;

        const badge = document.createElement('span');
        badge.className = 'badge rounded-pill sidebar-count';
        badge.id = `count-${cat.id}`;
        badge.style.background = cat.color;
        badge.textContent = '0';

        link.appendChild(iconSpan);
        link.appendChild(nameSpan);
        link.appendChild(badge);

        sidebarList.appendChild(link);
    });
}

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    const fileManageModal = document.getElementById('file-manage-modal');
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    const addCategoryDialog = document.getElementById('add-category-dialog');

    if (e.target === fileManageModal) {
        closeFileManageModal();
    }

    if (e.target === deleteConfirmModal) {
        closeDeleteConfirmModal();
    }

    if (e.target === addCategoryDialog) {
        closeAddCategoryDialog();
    }
});

// Keyboard support for modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        // Close modals in order of priority
        const addCategoryDialog = document.getElementById('add-category-dialog');
        const deleteConfirmModal = document.getElementById('delete-confirm-modal');
        const fileManageModal = document.getElementById('file-manage-modal');

        if (addCategoryDialog && addCategoryDialog.style.display === 'block') {
            closeAddCategoryDialog();
        } else if (deleteConfirmModal && deleteConfirmModal.style.display === 'block') {
            closeDeleteConfirmModal();
        } else if (fileManageModal && fileManageModal.style.display === 'block') {
            closeFileManageModal();
        }
    }
});

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Initialize history state for home page to preserve browser history stack
    if (!window.history.state) {
        const params = new URLSearchParams(window.location.search);
        const filter = params.get('filter') || 'all';
        const search = params.get('search') || '';
        const texPath = params.get('tex');
        const leftPdf = params.get('left');

        // Set appropriate initial state based on URL
        if (texPath) {
            // Tex editor state
            window.history.replaceState({
                texEditor: true,
                texPath: decodePathFromURL(texPath),
                filter: filter
            }, '', window.location.pathname + window.location.search);
        } else if (leftPdf) {
            // PDF viewer state - let restoreStateFromURL handle this
            // Just don't set home state
        } else {
            // Home state
            window.history.replaceState({
                home: true,
                filter: filter,
                search: search
            }, '', window.location.pathname + window.location.search);
        }
    }

    loadPDFStructure();
    initializeFileSelection();
    updateLocalPathDisplay();
});

// Update local path display based on current subject
function updateLocalPathDisplay() {
    const pathDisplay = document.getElementById('local-path-display');
    if (!pathDisplay) return;

    // Detect OS (Mac vs Windows)
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isWindows = navigator.platform.toUpperCase().indexOf('WIN') >= 0;

    // Get current subject from breadcrumb or use default
    const currentSubject = document.getElementById('breadcrumb-subject')?.textContent || 'machine intelligence';

    // Build path based on OS
    let basePath;
    if (isWindows) {
        basePath = 'C:\\Users\\Student\\Documents\\GitHub\\Semester6\\course-materials\\app\\subjects\\';
    } else {
        basePath = '~/Documents/GitHub/Semester6/course-materials/app/subjects/';
    }

    // Convert subject name to folder format (e.g., "machine intelligence" -> "MACHINE-INT")
    const subjectFolder = currentSubject.toUpperCase().replace(/ /g, '-');
    pathDisplay.textContent = basePath + subjectFolder + '/';
}

// ============================================================================
// CATEGORY MANAGER
// ============================================================================

async function openCategoryManager() {
    const modal = document.getElementById('category-manager-modal');
    const list = document.getElementById('category-manager-list');

    modal.style.display = 'block';

    // Load categories
    list.innerHTML = '<div style="text-align: center; padding: 20px; color: #8e8e93;">Loading...</div>';

    try {
        const subjectResponse = await fetch('/api/current-subject');
        const subjectData = await subjectResponse.json();

        if (!subjectData.success || !subjectData.subject) {
            list.innerHTML = '<div style="text-align: center; padding: 20px; color: #ff3b30;">No subject selected</div>';
            return;
        }

        // Get all categories (built-in + custom)
        const allCategories = [
            { id: 'notes', name: 'Lecture Notes', icon: 'fa-file-alt', color: '#34C759', isBuiltIn: true },
            { id: 'slides', name: 'Lecture Slides', icon: 'fa-graduation-cap', color: '#5AC8FA', isBuiltIn: true },
            { id: 'exercises', name: 'Exercises', icon: 'fa-pencil-alt', color: '#FFCC00', isBuiltIn: true },
            { id: 'exercises-no-solutions', name: 'Exercises (No Solutions)', icon: 'fa-clipboard-list', color: '#8e8e93', isBuiltIn: true },
            { id: 'blueprint', name: 'Blueprint', icon: 'fa-ruler-combined', color: '#FF3B30', isBuiltIn: true },
            { id: 'teachers-method', name: 'Teachers Method', icon: 'fa-bullseye', color: '#1d1d1f', isBuiltIn: true }
        ];

        // Load custom categories
        const response = await fetch(`/api/custom-categories/${subjectData.subject.code}`);
        const data = await response.json();

        if (data.success && data.categories) {
            // Add custom categories
            data.categories.forEach(cat => {
                allCategories.push({
                    ...cat,
                    isBuiltIn: false
                });
            });
        }

        displayCategoriesInManager(allCategories);
    } catch (error) {
        console.error('Error loading categories:', error);
        list.innerHTML = '<div style="text-align: center; padding: 20px; color: #ff3b30;">Failed to load categories</div>';
    }
}

function displayCategoriesInManager(categories) {
    const list = document.getElementById('category-manager-list');

    if (categories.length === 0) {
        list.innerHTML = '<div style="text-align: center; padding: 20px; color: #8e8e93;">No categories found.</div>';
        return;
    }

    list.innerHTML = categories.map(cat => {
        // Count files in this category
        const count = allFiles.filter(f => {
            // Map fileType to category ID
            if (f.fileType === 'notes' && cat.id === 'notes') return true;
            if (f.fileType === 'slides' && cat.id === 'slides') return true;
            if (f.fileType === 'exercises' && cat.id === 'exercises') return true;
            if (f.fileType === 'exercises-no-solutions' && cat.id === 'exercises-no-solutions') return true;
            if (f.fileType === 'blueprint' && cat.id === 'blueprint') return true;
            if (f.fileType === 'teachers-method' && cat.id === 'teachers-method') return true;
            if (f.fileType === cat.id) return true;
            return false;
        }).length;

        const renameBtn = cat.isBuiltIn ? '' : `
            <button class="category-item-btn" onclick="renameCategory('${cat.id}', '${cat.name.replace(/'/g, "\\'")}')" title="Rename category">
                <i class="fas fa-edit"></i>
            </button>
        `;

        const deleteBtn = cat.isBuiltIn ? '' : `
            <button class="category-item-btn delete" onclick="deleteCategory('${cat.id}', '${cat.name.replace(/'/g, "\\'")}')" title="Delete category">
                <i class="fas fa-trash"></i>
            </button>
        `;

        return `
            <div class="category-card">
                <div class="category-card-icon" style="background: ${cat.color}">
                    <i class="fas ${cat.icon}"></i>
                </div>
                <div class="category-card-info">
                    <div class="category-card-name">${cat.name}</div>
                    <div class="category-card-count">${count} file${count !== 1 ? 's' : ''}</div>
                    ${cat.isBuiltIn ? '<div class="category-card-badge">Built-in</div>' : '<div class="category-card-badge custom">Custom</div>'}
                </div>
                <div class="category-card-actions">
                    ${renameBtn}
                    ${deleteBtn}
                </div>
            </div>
        `;
    }).join('');
}

function closeCategoryManager() {
    document.getElementById('category-manager-modal').style.display = 'none';
}

async function renameCategory(categoryId, oldName) {
    const newName = prompt(`Rename category "${oldName}":`, oldName);

    if (!newName || newName.trim() === '' || newName === oldName) {
        return;
    }

    const newCategoryId = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    try {
        const subjectResponse = await fetch('/api/current-subject');
        const subjectData = await subjectResponse.json();

        if (!subjectData.success || !subjectData.subject) {
            showNotification('Error: No subject selected', 3000);
            return;
        }

        const response = await fetch(`/api/custom-categories/${subjectData.subject.code}/${categoryId}/rename`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                newName: newName,
                newCategoryId: newCategoryId
            })
        });

        const result = await response.json();

        if (result.success) {
            showNotification('Category renamed successfully', 3000);
            await loadPDFStructure();
            openCategoryManager(); // Refresh the list
        } else {
            showNotification('Failed to rename category: ' + result.error, 4000);
        }
    } catch (error) {
        console.error('Error renaming category:', error);
        showNotification('Failed to rename category: ' + error.message, 4000);
    }
}

async function deleteCategory(categoryId, categoryName) {
    // Get file count
    const fileCount = allFiles.filter(f => f.fileType === categoryId).length;

    if (fileCount > 0) {
        if (!confirm(`"${categoryName}" contains ${fileCount} file(s). Deleting this category will move all files to "Lecture Notes". Continue?`)) {
            return;
        }
    } else {
        if (!confirm(`Delete "${categoryName}" category?`)) {
            return;
        }
    }

    try {
        const subjectResponse = await fetch('/api/current-subject');
        const subjectData = await subjectResponse.json();

        if (!subjectData.success || !subjectData.subject) {
            showNotification('Error: No subject selected', 3000);
            return;
        }

        const response = await fetch(`/api/custom-categories/${subjectData.subject.code}/${categoryId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showNotification(`Category deleted. ${fileCount} file(s) moved to Lecture Notes`, 3000);
            await loadPDFStructure();
            openCategoryManager(); // Refresh the list
        } else {
            showNotification('Failed to delete category: ' + result.error, 4000);
        }
    } catch (error) {
        console.error('Error deleting category:', error);
        showNotification('Failed to delete category', 4000);
    }
}

// ============================================================================
// DRAG SELECTION FOR FILES
// ============================================================================

let selectedFiles = new Set();
let isDragging = false;
let dragStartX, dragStartY;
let selectionBox;

function initializeFileSelection() {
    // Disabled - file selection removed per user request
    // Files can only be opened by clicking, no multi-select
}

function updateSelectionFromBox() {
    const box = selectionBox.getBoundingClientRect();
    const rows = document.querySelectorAll('#file-list-body tr');

    selectedFiles.clear();

    rows.forEach((row, index) => {
        const rowRect = row.getBoundingClientRect();

        // Check if row intersects with selection box
        if (!(rowRect.right < box.left ||
              rowRect.left > box.right ||
              rowRect.bottom < box.top ||
              rowRect.top > box.bottom)) {
            selectedFiles.add(index);
        }
    });

    updateSelectionUI();
}

function toggleFileSelection(index) {
    if (selectedFiles.has(index)) {
        selectedFiles.delete(index);
    } else {
        selectedFiles.add(index);
    }
    updateSelectionUI();
}

function updateSelectionUI() {
    const rows = document.querySelectorAll('#file-list-body tr');
    const selectionInfo = document.getElementById('selection-info');
    const selectionCount = document.getElementById('selection-count');

    rows.forEach((row, index) => {
        if (selectedFiles.has(index)) {
            row.classList.add('selected');
        } else {
            row.classList.remove('selected');
        }
    });

    if (selectedFiles.size > 0) {
        selectionInfo.style.display = 'flex';
        selectionCount.textContent = selectedFiles.size;
    } else {
        selectionInfo.style.display = 'none';
    }
}

function clearSelection() {
    selectedFiles.clear();
    updateSelectionUI();
}

function getSelectedFiles() {
    return Array.from(selectedFiles).map(index => allFiles[index]);
}

// ============================================================================
// ASK CLAUDE - FLOATING CHAT BUBBLE
// ============================================================================

let chatBubbleOpen = false;
let chatHistory = {}; // Per-document chat history

// Initialize chat bubble in PDF modal - NOW OPENS STUDY WITH CLAUDE
function initializeChatBubble() {
    const modal = document.getElementById('pdf-modal');
    if (!modal || document.getElementById('claude-chat-bubble')) return;

    const chatBubble = document.createElement('div');
    chatBubble.id = 'claude-chat-bubble';
    chatBubble.className = 'claude-chat-bubble';
    chatBubble.innerHTML = `
        <button class="chat-bubble-trigger" onclick="openStudyWithClaude()" title="Study with Claude (Cmd/Ctrl+Shift+S)">
            <i class="fas fa-graduation-cap"></i>
        </button>
    `;
    modal.appendChild(chatBubble);
}

// Toggle chat bubble visibility - NOW REDIRECTS TO STUDY PANEL
function toggleChatBubble() {
    // Redirect to new Study with Claude panel
    openStudyWithClaude();
}

// Update document selector based on current view state
function updateChatDocumentSelector() {
    const nameEl = document.getElementById('chat-document-name');
    const selectEl = document.getElementById('chat-document-select');
    if (!nameEl || !selectEl) return;

    // Check if we're in tex editor mode (global from tex-editor.js)
    if (typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen && typeof currentTexFile !== 'undefined' && currentTexFile.path) {
        // TeX editor mode - show tex file name
        const fileName = currentTexFile.name || currentTexFile.path.split('/').pop();
        nameEl.textContent = fileName;
        nameEl.title = currentTexFile.path;
        nameEl.style.display = 'inline';
        selectEl.style.display = 'none';
        return;
    }

    // PDF viewer mode
    if (isSplitView && currentRightPDF.path && currentLeftPDF.path) {
        // Split view - show dropdown
        const leftName = currentLeftPDF.name || currentLeftPDF.path.split('/').pop();
        const rightName = currentRightPDF.name || currentRightPDF.path.split('/').pop();

        selectEl.innerHTML = `
            <option value="left">${leftName}</option>
            <option value="right">${rightName}</option>
        `;
        nameEl.style.display = 'none';
        selectEl.style.display = 'inline-block';
    } else if (currentLeftPDF.path) {
        // Single PDF - show name
        const fileName = currentLeftPDF.name || currentLeftPDF.path.split('/').pop();
        nameEl.textContent = fileName;
        nameEl.title = currentLeftPDF.path;
        nameEl.style.display = 'inline';
        selectEl.style.display = 'none';
    } else {
        // No document
        nameEl.textContent = 'No document selected';
        nameEl.title = '';
        nameEl.style.display = 'inline';
        selectEl.style.display = 'none';
    }
}

// Get currently selected document path for chat
function getChatDocumentPath() {
    // Check if we're in tex editor mode
    if (typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen && typeof currentTexFile !== 'undefined' && currentTexFile.path) {
        // Return the associated PDF path if available, otherwise the tex path
        // The API will look for corresponding .tex file anyway
        return currentTexFile.path.replace(/\.tex$/i, '.pdf');
    }

    // PDF viewer mode
    const select = document.getElementById('chat-document-select');
    if (isSplitView && select && select.style.display !== 'none' && select.value === 'right') {
        return currentRightPDF.path;
    }
    return currentLeftPDF.path;
}

// Update chat document when dropdown changes
function updateChatDocument() {
    // Reload chat history for newly selected document
    loadChatHistoryForDocument();
}

// Handle Enter key in chat input
function handleChatKeydown(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        sendChatMessage();
    } else if (event.key === 'Escape') {
        toggleChatBubble();
    }
}

// Send chat message
async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const historyEl = document.getElementById('chat-history');
    if (!input || !historyEl) return;

    const question = input.value.trim();
    if (!question) return;

    const documentPath = getChatDocumentPath();
    if (!documentPath) {
        showNotification('No document selected', 3000);
        return;
    }

    // Clear input
    input.value = '';

    // Remove empty state if present
    const emptyState = historyEl.querySelector('.chat-empty');
    if (emptyState) emptyState.remove();

    // Add user message to history
    appendChatMessage('user', question);

    // Add loading indicator
    const loadingId = appendChatMessage('loading', 'Thinking... (this may take a moment)');

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

    try {
        const response = await fetch('/api/ask-claude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: question,
                documentPath: documentPath
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Remove loading indicator
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (data.success) {
            appendChatMessage('assistant', data.answer, data.sourceFile);
            // Save to history
            saveChatToHistory(documentPath, question, data.answer);
        } else {
            appendChatMessage('error', data.error || 'Failed to get response');
        }
    } catch (error) {
        clearTimeout(timeoutId);

        // Remove loading indicator
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (error.name === 'AbortError') {
            appendChatMessage('error', 'Request timed out. Please try again.');
        } else {
            appendChatMessage('error', 'Error: ' + error.message);
        }
    }
}

// Append message to chat history
function appendChatMessage(type, content, sourceFile = null) {
    const historyEl = document.getElementById('chat-history');
    if (!historyEl) return null;

    const messageId = 'chat-msg-' + Date.now();
    const message = document.createElement('div');
    message.id = messageId;
    message.className = `chat-message ${type}`;

    if (type === 'user') {
        message.innerHTML = `
            <div class="chat-message-content">
                <i class="fas fa-user"></i>
                <span>${escapeHtmlForChat(content)}</span>
            </div>
        `;
    } else if (type === 'assistant') {
        message.innerHTML = `
            <div class="chat-message-content">
                <i class="fas fa-magic"></i>
                <span>${formatClaudeResponse(content)}</span>
            </div>
            ${sourceFile ? `<div class="chat-source">Source: ${sourceFile}</div>` : ''}
        `;
    } else if (type === 'loading') {
        message.innerHTML = `
            <div class="chat-message-content">
                <i class="fas fa-spinner fa-spin"></i>
                <span>${content}</span>
            </div>
        `;
    } else if (type === 'error') {
        message.innerHTML = `
            <div class="chat-message-content error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${escapeHtmlForChat(content)}</span>
            </div>
        `;
    }

    historyEl.appendChild(message);
    historyEl.scrollTop = historyEl.scrollHeight;

    return messageId;
}

// Format Claude response (simple markdown)
function formatClaudeResponse(text) {
    // Escape HTML first
    let formatted = escapeHtmlForChat(text);
    // Bold
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Code
    formatted = formatted.replace(/`(.+?)`/g, '<code>$1</code>');
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    return formatted;
}

// Escape HTML for chat
function escapeHtmlForChat(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Save chat to history (localStorage for now, could use DB)
function saveChatToHistory(documentPath, question, answer) {
    if (!chatHistory[documentPath]) {
        chatHistory[documentPath] = [];
    }
    chatHistory[documentPath].push({
        question,
        answer,
        timestamp: Date.now()
    });

    // Also save to server
    fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            documentPath,
            question,
            answer
        })
    }).catch(e => console.log('Could not save chat history:', e));
}

// Load chat history for current document
async function loadChatHistoryForDocument() {
    const documentPath = getChatDocumentPath();
    if (!documentPath) return;

    const historyEl = document.getElementById('chat-history');
    if (!historyEl) return;

    // Clear current history display
    historyEl.innerHTML = '';

    // Check local cache first
    if (chatHistory[documentPath] && chatHistory[documentPath].length > 0) {
        chatHistory[documentPath].forEach(item => {
            appendChatMessage('user', item.question);
            appendChatMessage('assistant', item.answer);
        });
        return;
    }

    // Try to load from server
    try {
        const response = await fetch(`/api/chat-history?documentPath=${encodeURIComponent(documentPath)}`);
        const data = await response.json();

        if (data.success && data.history && data.history.length > 0) {
            chatHistory[documentPath] = data.history;
            data.history.forEach(item => {
                appendChatMessage('user', item.question);
                appendChatMessage('assistant', item.answer);
            });
        } else {
            // Show empty state
            historyEl.innerHTML = `
                <div class="chat-empty">
                    <i class="fas fa-comments"></i>
                    <span>Ask a question about this document</span>
                </div>
            `;
        }
    } catch (error) {
        // Show empty state on error
        historyEl.innerHTML = `
            <div class="chat-empty">
                <i class="fas fa-comments"></i>
                <span>Ask a question about this document</span>
            </div>
        `;
    }
}

// Update chat when document changes
function updateChatDocument() {
    loadChatHistoryForDocument();
}

// Initialize chat bubble when PDF modal opens
document.addEventListener('DOMContentLoaded', () => {
    // Watch for PDF modal opening
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'style') {
                const modal = document.getElementById('pdf-modal');
                if (modal && modal.style.display !== 'none') {
                    initializeChatBubble();
                }
            }
        });
    });

    const modal = document.getElementById('pdf-modal');
    if (modal) {
        observer.observe(modal, { attributes: true });
    }
});

// Keyboard shortcut for chat bubble (legacy - now opens Study with Claude)
document.addEventListener('keydown', (event) => {
    // Cmd/Ctrl + Shift + A - Open Study with Claude
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'a') {
        event.preventDefault();
        const modal = document.getElementById('pdf-modal');
        if (modal && modal.style.display !== 'none') {
            openStudyWithClaude();
        }
    }
    // Cmd/Ctrl + Shift + S - Also opens Study with Claude
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 's') {
        event.preventDefault();
        const modal = document.getElementById('pdf-modal');
        if (modal && modal.style.display !== 'none') {
            openStudyWithClaude();
        }
    }
});

// ============================================================================
// STUDY WITH CLAUDE - FULL SCREEN LEARNING ASSISTANT
// ============================================================================

let studyPanelOpen = false;
let studyReferencedFiles = [];
let studySubjectFiles = [];
let studyAutocompleteIndex = -1;
let studyMessages = [];
let studyCurrentDocument = null;
let studyIsLoading = false;
let studyPastedImages = []; // Store pasted images as base64

// Initialize Study panel - create DOM elements
function initializeStudyPanel() {
    if (document.getElementById('study-claude-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'study-claude-overlay';
    overlay.className = 'study-claude-overlay';
    overlay.innerHTML = `
        <div class="study-claude-container">
            <!-- Header -->
            <div class="study-claude-header">
                <div class="study-header-left">
                    <i class="fas fa-graduation-cap"></i>
                    <span>Study with Claude</span>
                </div>
                <div class="study-header-center">
                    <div class="study-context-info" id="study-context-info">
                        <!-- Primary document chip (removable) -->
                        <div class="study-primary-doc" id="study-primary-doc" style="display: none;">
                            <i class="fas fa-file-pdf"></i>
                            <span id="study-current-file">No file selected</span>
                            <button class="study-primary-doc-pages" onclick="openPrimaryDocPageSelector()" title="Select specific pages">
                                <i class="fas fa-layer-group"></i>
                            </button>
                            <button class="study-primary-doc-remove" onclick="detachPrimaryDocument()" title="Detach this file">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <button class="study-add-ref-btn" onclick="openStudyFileSelector()">
                            <i class="fas fa-plus"></i> Add Reference
                        </button>
                    </div>
                </div>
                <div class="study-header-right">
                    <button class="study-header-btn" onclick="clearStudyChat()" title="Clear Chat History">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                    <button class="study-header-btn" onclick="minimizeStudyPanel()" title="Minimize">
                        <i class="fas fa-minus"></i>
                    </button>
                    <button class="study-header-btn close" onclick="closeStudyPanel()" title="Close (Esc)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>

            <!-- Tab Bar -->
            <div class="study-tabs">
                <button class="study-tab active" id="study-tab-chat" onclick="switchStudyTab('chat')">
                    <i class="fas fa-comments"></i> Chat
                </button>
                <button class="study-tab" id="study-tab-history" onclick="switchStudyTab('history')">
                    <i class="fas fa-bookmark"></i> Saved Slides
                </button>
            </div>

            <!-- References Bar (only shown in chat mode) -->
            <div class="study-references-bar" id="study-references-bar">
                <span class="study-ref-label">References:</span>
            </div>

            <!-- Content Area -->
            <div class="study-content-area">
                <!-- Chat Panel -->
                <div class="study-panel-chat" id="study-panel-chat">
                    <div class="study-messages" id="study-messages">
                        <div class="study-empty-state" id="study-empty-state">
                            <i class="fas fa-graduation-cap"></i>
                            <h3>Start Learning</h3>
                            <p>Ask questions about your document. Claude will help you understand concepts, explain formulas, and create interactive study materials.</p>
                        </div>
                    </div>
                </div>
                <!-- History Panel -->
                <div class="study-panel-history" id="study-panel-history" style="display: none;">
                    <div class="study-history-loading" id="study-history-loading">
                        <i class="fas fa-spinner fa-spin"></i> Loading saved slides...
                    </div>
                    <div class="study-history-empty" id="study-history-empty" style="display: none;">
                        <i class="fas fa-bookmark"></i>
                        <h3>No Saved Slides</h3>
                        <p>Save slides from your chat responses using the bookmark button.</p>
                    </div>
                    <div class="study-history-list" id="study-history-list"></div>
                </div>
                <div class="study-slide-view" id="study-slide-view"></div>
            </div>

            <!-- Input Area -->
            <div class="study-input-area">
                <div class="study-image-preview" id="study-image-preview"></div>
                <div class="study-input-wrapper">
                    <textarea id="study-input" placeholder="Ask a question... (use @ to reference files, Ctrl+V to paste images)" rows="1" oninput="handleStudyInputChange(this)" onkeydown="handleStudyInputKeydown(event)"></textarea>
                    <div id="study-file-autocomplete" class="study-file-autocomplete"></div>
                </div>
                <div class="study-input-actions">
                    <div class="study-input-left-actions">
                        <label class="study-mode-btn" id="study-image-btn" title="Attach image">
                            <i class="fas fa-image"></i>
                            <input type="file" accept="image/*" style="display:none" onchange="handleStudyImageSelect(event)">
                        </label>
                    </div>
                    <button class="study-send-btn" id="study-send-btn" onclick="sendStudyMessage()">
                        <i class="fas fa-paper-plane"></i> Send
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Close on overlay click (outside container)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeStudyPanel();
        }
    });

    // Close on Escape (only if not typing in input)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && studyPanelOpen) {
            // If typing, just blur the input instead of closing panel
            if (isUserTypingInInput()) {
                document.activeElement.blur();
            } else {
                closeStudyPanel();
            }
        }
    });

    // Handle paste for images
    overlay.addEventListener('paste', handleStudyPaste);
}

// Open Study with Claude panel
function openStudyWithClaude(documentPath = null) {
    initializeStudyPanel();

    const overlay = document.getElementById('study-claude-overlay');
    if (!overlay) return;

    // Reset primary doc page selection state
    studyPrimaryDocPages = null;
    studyPrimaryDocExtractedPath = null;

    // Determine current document
    if (documentPath) {
        studyCurrentDocument = documentPath;
    } else if (typeof isTexEditorOpen !== 'undefined' && isTexEditorOpen && typeof currentTexFile !== 'undefined' && currentTexFile.path) {
        studyCurrentDocument = currentTexFile.path;
    } else if (currentLeftPDF && currentLeftPDF.path) {
        studyCurrentDocument = currentLeftPDF.path;
    }

    // Update file display
    updateStudyFileDisplay();

    // Load subject files for @ references
    loadStudySubjectFiles();

    // Load existing chat history for this document
    loadStudyHistory();

    overlay.classList.add('open');
    overlay.classList.remove('minimized');
    studyPanelOpen = true;

    // Focus input
    setTimeout(() => {
        const input = document.getElementById('study-input');
        if (input) input.focus();
    }, 300);
}

// Close Study panel
function closeStudyPanel() {
    const overlay = document.getElementById('study-claude-overlay');
    if (overlay) {
        overlay.classList.remove('open');
        overlay.classList.remove('minimized');
    }
    studyPanelOpen = false;
}

// Minimize Study panel
function minimizeStudyPanel() {
    const overlay = document.getElementById('study-claude-overlay');
    if (overlay) {
        overlay.classList.toggle('minimized');
    }
}

// Clear Study chat history
function clearStudyChat() {
    if (studyMessages.length === 0) return;

    if (confirm('Clear all chat history? This cannot be undone.')) {
        studyMessages = [];
        renderStudyMessages();

        // Show empty state again
        const emptyState = document.getElementById('study-empty-state');
        if (emptyState) emptyState.style.display = 'flex';
    }
}

// Primary document state (for page selection)
let studyPrimaryDocPages = null; // null = full doc, array = selected pages
let studyPrimaryDocExtractedPath = null; // path to extracted PDF if pages selected

// Update file display in header
function updateStudyFileDisplay() {
    const fileEl = document.getElementById('study-current-file');
    const primaryDocEl = document.getElementById('study-primary-doc');
    if (!fileEl || !primaryDocEl) return;

    if (studyCurrentDocument) {
        const fileName = studyCurrentDocument.split('/').pop();
        const hasPages = studyPrimaryDocPages && studyPrimaryDocPages.length > 0;
        const pageInfo = hasPages ? ` (p${formatStudyPageRange(studyPrimaryDocPages)})` : '';

        fileEl.textContent = fileName + pageInfo;
        fileEl.title = studyCurrentDocument;
        primaryDocEl.style.display = 'flex';

        // Update icon based on file type
        const icon = primaryDocEl.querySelector('i:first-child');
        if (icon) {
            const isTex = studyCurrentDocument.endsWith('.tex');
            icon.className = `fas fa-file-${isTex ? 'code' : 'pdf'}`;
        }

        // Update page selector button visibility (only for PDFs)
        const pageBtn = primaryDocEl.querySelector('.study-primary-doc-pages');
        if (pageBtn) {
            pageBtn.style.display = studyCurrentDocument.endsWith('.pdf') ? 'flex' : 'none';
        }

        // Add has-pages class for styling
        primaryDocEl.classList.toggle('has-pages', hasPages);
    } else {
        fileEl.textContent = 'No file selected';
        fileEl.title = '';
        primaryDocEl.style.display = 'none';
    }
}

// Detach the primary document
function detachPrimaryDocument() {
    studyCurrentDocument = null;
    studyPrimaryDocPages = null;
    studyPrimaryDocExtractedPath = null;
    updateStudyFileDisplay();
    showNotification('Primary document detached', 2000);
}

// Open page selector for primary document
function openPrimaryDocPageSelector() {
    if (!studyCurrentDocument || !studyCurrentDocument.endsWith('.pdf')) return;

    const fileName = studyCurrentDocument.split('/').pop();
    openPageSelector(studyCurrentDocument, fileName, handlePrimaryDocPageSelection, 'study');
}

// Handle page selection for primary document
function handlePrimaryDocPageSelection(result) {
    studyPrimaryDocPages = result.pages;
    studyPrimaryDocExtractedPath = result.isExtracted ? result.path : null;
    updateStudyFileDisplay();
}

// Load subject files for @ mentions
async function loadStudySubjectFiles() {
    // Try to get a path to extract subject from
    let pathToUse = studyCurrentDocument;

    // If no primary doc, try to use first referenced file
    if (!pathToUse && studyReferencedFiles.length > 0) {
        pathToUse = studyReferencedFiles[0].originalPath || studyReferencedFiles[0].path;
    }

    if (!pathToUse) {
        console.log('loadStudySubjectFiles: No document or reference selected');
        return;
    }

    // Decode URL-encoded path if needed
    let decodedPath = pathToUse;
    try {
        // Handle double-encoding (e.g., %252F -> %2F -> /)
        while (decodedPath.includes('%')) {
            const newPath = decodeURIComponent(decodedPath);
            if (newPath === decodedPath) break;
            decodedPath = newPath;
        }
    } catch (e) {
        console.log('Path decoding failed, using original:', pathToUse);
        decodedPath = pathToUse;
    }

    console.log('loadStudySubjectFiles: Document path:', decodedPath);

    // Extract subject from path (e.g., subjects/DBS/notes/...)
    const pathParts = decodedPath.split('/');
    const subjectIndex = pathParts.indexOf('subjects');
    if (subjectIndex === -1 || subjectIndex + 1 >= pathParts.length) {
        console.error('Could not extract subject from path:', decodedPath);
        studySubjectFiles = [];
        return;
    }

    const subject = pathParts[subjectIndex + 1];
    console.log('loadStudySubjectFiles: Subject:', subject);

    try {
        const response = await fetch(`/api/subject-files/${subject}`);
        if (response.ok) {
            studySubjectFiles = await response.json();
            console.log(`Loaded ${studySubjectFiles.length} files for subject ${subject}`);
        } else {
            console.error('Failed to load subject files:', response.status, response.statusText);
            studySubjectFiles = [];
        }
    } catch (error) {
        console.error('Error loading subject files:', error);
        studySubjectFiles = [];
    }
}

// Handle input changes for @ autocomplete
function handleStudyInputChange(textarea) {
    // Auto-resize textarea
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([^\s@]*)$/);

    if (atMatch) {
        showStudyFileAutocomplete(atMatch[1]);
    } else {
        hideStudyFileAutocomplete();
    }
}

// Show file autocomplete dropdown
async function showStudyFileAutocomplete(query) {
    const autocomplete = document.getElementById('study-file-autocomplete');
    if (!autocomplete) return;

    // Ensure files are loaded
    if (studySubjectFiles.length === 0) {
        await loadStudySubjectFiles();
    }

    const filtered = studySubjectFiles.filter(f =>
        f.name.toLowerCase().includes(query.toLowerCase()) ||
        f.path.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);

    if (filtered.length === 0) {
        hideStudyFileAutocomplete();
        return;
    }

    autocomplete.innerHTML = filtered.map((file, i) => `
        <div class="study-file-autocomplete-item ${i === 0 ? 'selected' : ''}"
             data-file="${file.path}"
             onclick="selectStudyAutocompleteFile('${file.path}')">
            <i class="fas fa-file-${file.path.endsWith('.tex') ? 'code' : 'pdf'}"></i>
            <span>${file.name}</span>
            <span class="file-path">${file.path.split('/').slice(-2, -1)[0] || ''}</span>
        </div>
    `).join('');

    autocomplete.classList.add('visible');
    studyAutocompleteIndex = 0;
}

// Hide file autocomplete
function hideStudyFileAutocomplete() {
    const autocomplete = document.getElementById('study-file-autocomplete');
    if (autocomplete) {
        autocomplete.classList.remove('visible');
    }
    studyAutocompleteIndex = -1;
}

// Select file from autocomplete
function selectStudyAutocompleteFile(filePath) {
    const textarea = document.getElementById('study-input');
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPos);
    const textAfterCursor = textarea.value.substring(cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
        const fileName = filePath.split('/').pop();
        textarea.value = textBeforeCursor.substring(0, atIndex) + '@' + fileName + ' ' + textAfterCursor;
        textarea.selectionStart = textarea.selectionEnd = atIndex + fileName.length + 2;
    }

    // Add to referenced files
    if (!studyReferencedFiles.find(f => f.path === filePath)) {
        const fileInfo = studySubjectFiles.find(f => f.path === filePath);
        if (fileInfo) {
            studyReferencedFiles.push(fileInfo);
            renderStudyReferencedFiles();
        }
    }

    hideStudyFileAutocomplete();
    handleStudyInputChange(textarea);
    textarea.focus();
}

// Render referenced files bar
function renderStudyReferencedFiles() {
    const bar = document.getElementById('study-references-bar');
    if (!bar) return;

    if (studyReferencedFiles.length === 0) {
        bar.classList.remove('visible');
        return;
    }

    bar.classList.add('visible');
    bar.innerHTML = `
        <span class="study-ref-label">References:</span>
        ${studyReferencedFiles.map(file => {
            const isYouTube = file.type === 'youtube';
            const isPdf = !isYouTube && file.path.endsWith('.pdf');
            const hasPages = file.selectedPages && file.selectedPages.length > 0;
            const pageInfo = hasPages ? ` (p${formatStudyPageRange(file.selectedPages)})` : '';

            // Determine icon
            let iconClass = 'fas fa-file-code';
            let iconStyle = '';
            if (isYouTube) {
                iconClass = 'fab fa-youtube';
                iconStyle = 'color: #FF0000;';
            } else if (isPdf) {
                iconClass = 'fas fa-file-pdf';
            }

            return `
            <div class="study-ref-chip ${hasPages ? 'has-pages' : ''} ${isYouTube ? 'youtube-ref' : ''}" data-path="${file.originalPath || file.path}">
                <i class="${iconClass}" style="${iconStyle}"></i>
                <span>${file.name}${pageInfo}</span>
                ${isPdf ? `
                    <button class="select-pages-btn" onclick="openStudyPageSelector('${file.originalPath || file.path}', '${file.name}')" title="Select specific pages">
                        <i class="fas fa-layer-group"></i>
                    </button>
                ` : ''}
                <button onclick="removeStudyReference('${file.originalPath || file.path}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `}).join('')}
    `;
}

// Format page range for display
function formatStudyPageRange(pages) {
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

// Open page selector for a study reference
function openStudyPageSelector(filePath, fileName) {
    openPageSelector(filePath, fileName, handleStudyPageSelection, 'study');
}

// Handle page selection callback
function handleStudyPageSelection(result) {
    // Find and update the referenced file
    const index = studyReferencedFiles.findIndex(f => (f.originalPath || f.path) === result.originalPath);
    if (index !== -1) {
        // Update with extraction info
        studyReferencedFiles[index] = {
            ...studyReferencedFiles[index],
            path: result.path,
            originalPath: result.originalPath,
            name: result.originalName,
            selectedPages: result.pages,
            isExtracted: result.isExtracted
        };
        renderStudyReferencedFiles();
    }
}

// Remove a referenced file
function removeStudyReference(filePath) {
    studyReferencedFiles = studyReferencedFiles.filter(f => (f.originalPath || f.path) !== filePath);
    renderStudyReferencedFiles();
}

// Handle keyboard in input
function handleStudyInputKeydown(event) {
    const autocomplete = document.getElementById('study-file-autocomplete');
    const isAutocompleteVisible = autocomplete && autocomplete.classList.contains('visible');

    if (isAutocompleteVisible) {
        const items = autocomplete.querySelectorAll('.study-file-autocomplete-item');

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            studyAutocompleteIndex = Math.min(studyAutocompleteIndex + 1, items.length - 1);
            updateStudyAutocompleteSelection(items);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            studyAutocompleteIndex = Math.max(studyAutocompleteIndex - 1, 0);
            updateStudyAutocompleteSelection(items);
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            if (studyAutocompleteIndex >= 0 && items[studyAutocompleteIndex]) {
                event.preventDefault();
                selectStudyAutocompleteFile(items[studyAutocompleteIndex].dataset.file);
            }
        } else if (event.key === 'Escape') {
            hideStudyFileAutocomplete();
        }
    } else {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendStudyMessage();
        }
    }
}

// Update autocomplete selection highlight
function updateStudyAutocompleteSelection(items) {
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === studyAutocompleteIndex);
    });
    if (items[studyAutocompleteIndex]) {
        items[studyAutocompleteIndex].scrollIntoView({ block: 'nearest' });
    }
}

// Toggle slide mode
function toggleStudySlideMode() {
    studySlideMode = !studySlideMode;
    const btn = document.getElementById('study-slide-mode-btn');
    if (btn) {
        btn.classList.toggle('active', studySlideMode);
    }
}

// Handle paste event for images
function handleStudyPaste(event) {
    const items = event.clipboardData?.items;
    if (!items) return;

    // Check for images first
    for (const item of items) {
        if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
                addStudyImage(file);
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
            showYouTubeLanguageModal(videoId, pastedText);
        }
    }
}

// Show modal to select language for YouTube video
function showYouTubeLanguageModal(videoId, originalUrl) {
    // Remove any existing modal
    const existingModal = document.getElementById('youtube-lang-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'youtube-lang-modal';
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
            <button onclick="addYouTubeFromModal('${videoId}', 'auto')" style="padding: 12px 16px; background: linear-gradient(135deg, #F59E0B, #D97706); border: none; border-radius: 8px; color: #fff; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-magic"></i> Auto-detect (Recommended)
            </button>
            <button onclick="addYouTubeFromModal('${videoId}', 'en')" style="padding: 12px 16px; background: #3c3c3c; border: 1px solid #4c4c4c; border-radius: 8px; color: #e0e0e0; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 16px;">🇬🇧</span> English
            </button>
            <button onclick="addYouTubeFromModal('${videoId}', 'hi')" style="padding: 12px 16px; background: #3c3c3c; border: 1px solid #4c4c4c; border-radius: 8px; color: #e0e0e0; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 16px;">🇮🇳</span> Hindi (YouTube captions)
            </button>
            <button onclick="addYouTubeFromModal('${videoId}', 'hi-whisper')" style="padding: 12px 16px; background: linear-gradient(135deg, #8B5CF6, #6D28D9); border: none; border-radius: 8px; color: #fff; font-size: 14px; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-robot"></i> Hindi → English (AI Whisper)
            </button>
        </div>
        <div style="margin-top: 12px; padding: 10px; background: rgba(139, 92, 246, 0.1); border-radius: 8px; font-size: 11px; color: #a78bfa;">
            <i class="fas fa-info-circle"></i> AI Whisper downloads audio & translates Hindi speech to English. Takes 1-3 min but gives best quality for Hindi videos.
        </div>
        <button onclick="document.getElementById('youtube-lang-modal').remove()" style="width: 100%; margin-top: 12px; padding: 10px; background: none; border: 1px solid #4c4c4c; border-radius: 8px; color: #8e8e93; font-size: 13px; cursor: pointer;">
            Cancel
        </button>
    `;

    document.body.appendChild(modal);

    // Close on click outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// Add YouTube from the language modal
async function addYouTubeFromModal(videoId, language) {
    const modal = document.getElementById('youtube-lang-modal');

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

        // Add as a YouTube reference
        const ytRef = {
            name: `YouTube: ${data.videoId}`,
            path: `youtube://${data.videoId}`,
            type: 'youtube',
            videoId: data.videoId,
            language: data.language,
            transcript: data.fullText,
            timestampedText: data.timestampedText,
            lineCount: data.lineCount
        };

        if (!studyReferencedFiles.find(f => f.path === ytRef.path)) {
            studyReferencedFiles.push(ytRef);
            renderStudyReferencedFiles();
        }

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
                    <button onclick="document.getElementById('youtube-lang-modal').remove()" style="padding: 10px 20px; background: #3c3c3c; border: none; border-radius: 8px; color: #e0e0e0; cursor: pointer;">
                        Close
                    </button>
                </div>
            `;
        }
    }
}

// Handle image file selection
function handleStudyImageSelect(event) {
    const file = event.target.files[0];
    if (file && file.type.startsWith('image/')) {
        addStudyImage(file);
    }
    // Reset input so same file can be selected again
    event.target.value = '';
}

// Add image to the study panel
function addStudyImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        studyPastedImages.push({
            data: base64,
            name: file.name || 'pasted-image.png',
            type: file.type
        });
        renderStudyImagePreviews();
    };
    reader.readAsDataURL(file);
}

// Render image previews
function renderStudyImagePreviews() {
    const container = document.getElementById('study-image-preview');
    if (!container) return;

    if (studyPastedImages.length === 0) {
        container.classList.remove('has-images');
        container.innerHTML = '';
        return;
    }

    container.classList.add('has-images');
    container.innerHTML = studyPastedImages.map((img, i) => `
        <div class="study-image-preview-item">
            <img src="${img.data}" alt="${img.name}">
            <button class="study-image-remove" onclick="removeStudyImage(${i})" title="Remove image">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

// Remove an image
function removeStudyImage(index) {
    studyPastedImages.splice(index, 1);
    renderStudyImagePreviews();
}

// Open file selector modal (for Add Reference button)
async function openStudyFileSelector() {
    // Create or get modal
    let modal = document.getElementById('study-file-picker-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'study-file-picker-modal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #252528;
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 20px;
            z-index: 100001;
            max-width: 500px;
            width: 90%;
            max-height: 500px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(modal);
    }

    // Show loading state first
    modal.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; color: #fff; font-size: 16px;">Add Reference File</h3>
            <button onclick="document.getElementById('study-file-picker-modal').remove()" style="background: none; border: none; color: #8e8e93; cursor: pointer; font-size: 18px;">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div style="padding: 40px; text-align: center; color: #8e8e93;">
            <i class="fas fa-spinner fa-spin" style="font-size: 24px; margin-bottom: 12px;"></i>
            <p>Loading files...</p>
        </div>
    `;
    modal.style.display = 'block';

    // Load files
    await loadStudySubjectFiles();

    // Build file list
    const fileListHtml = studySubjectFiles.length > 0
        ? studySubjectFiles.map(file => {
            const escapedPath = file.path.replace(/'/g, "\\'");
            return `
                <div class="study-file-picker-item" data-path="${file.path}" onclick="addStudyFileReference('${escapedPath}')" style="padding: 12px; cursor: pointer; border-radius: 8px; display: flex; align-items: center; gap: 10px; transition: background 0.15s; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <i class="fas fa-file-${file.path.endsWith('.tex') ? 'code' : 'pdf'}" style="color: #F59E0B;"></i>
                    <div style="flex: 1; overflow: hidden;">
                        <div style="color: #e0e0e0; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.name}</div>
                        <div style="color: #6e6e6e; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${file.path}</div>
                    </div>
                </div>
            `;
        }).join('')
        : '<div style="padding: 40px; text-align: center; color: #6e6e6e;"><i class="fas fa-folder-open" style="font-size: 32px; margin-bottom: 12px; opacity: 0.5;"></i><p>No files found in this subject folder</p></div>';

    // Update modal content
    modal.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; color: #fff; font-size: 16px;">Add Reference</h3>
            <button onclick="document.getElementById('study-file-picker-modal').remove()" style="background: none; border: none; color: #8e8e93; cursor: pointer; font-size: 18px;">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <!-- YouTube URL Section -->
        <div style="background: #1a1a1c; border: 1px solid #3c3c3c; border-radius: 10px; padding: 12px; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                <i class="fab fa-youtube" style="color: #FF0000; font-size: 16px;"></i>
                <span style="color: #e0e0e0; font-size: 13px; font-weight: 500;">YouTube Video</span>
            </div>
            <div style="display: flex; gap: 8px;">
                <input type="text" id="youtube-url-input" placeholder="Paste YouTube URL..." style="flex: 1; padding: 8px 12px; background: #252528; border: 1px solid #3c3c3c; border-radius: 6px; color: #e0e0e0; font-size: 13px; outline: none;" onkeydown="if(event.key==='Enter')addYouTubeReference()">
                <select id="youtube-lang-select" style="padding: 8px; background: #252528; border: 1px solid #3c3c3c; border-radius: 6px; color: #e0e0e0; font-size: 12px; outline: none;">
                    <option value="auto">Auto</option>
                    <option value="en">English</option>
                    <option value="hi">Hindi</option>
                    <option value="hi-whisper">Hindi→EN (AI)</option>
                </select>
                <button onclick="addYouTubeReference()" style="padding: 8px 14px; background: #FF0000; border: none; border-radius: 6px; color: #fff; font-size: 12px; cursor: pointer; white-space: nowrap;">
                    <i class="fas fa-plus"></i> Add
                </button>
            </div>
            <div id="youtube-status" style="margin-top: 8px; font-size: 11px; color: #6e6e6e; display: none;"></div>
        </div>

        <!-- Files Section -->
        <div style="color: #8e8e93; font-size: 12px; margin-bottom: 8px;">Or select a file:</div>
        <input type="text" id="study-file-search" placeholder="Search files..." style="width: 100%; padding: 10px 14px; background: #1e1e1e; border: 1px solid #3c3c3c; border-radius: 8px; color: #e0e0e0; font-size: 14px; margin-bottom: 12px; outline: none;" oninput="filterStudyFilePicker(this.value)">
        <div id="study-file-picker-list" style="max-height: 280px; overflow-y: auto;">
            ${fileListHtml}
        </div>
        <div style="margin-top: 12px; font-size: 11px; color: #6e6e6e; text-align: center;">
            ${studySubjectFiles.length} files available
        </div>
    `;

    // Add hover styles
    modal.querySelectorAll('.study-file-picker-item').forEach(item => {
        item.addEventListener('mouseenter', () => item.style.background = 'rgba(245, 158, 11, 0.15)');
        item.addEventListener('mouseleave', () => item.style.background = 'transparent');
    });

    // Focus search input
    const searchInput = document.getElementById('study-file-search');
    if (searchInput) searchInput.focus();
}

// Filter file picker list
function filterStudyFilePicker(query) {
    const items = document.querySelectorAll('#study-file-picker-list .study-file-picker-item');
    items.forEach(item => {
        const path = item.dataset.path.toLowerCase();
        item.style.display = path.includes(query.toLowerCase()) ? 'flex' : 'none';
    });
}

// Add file reference from picker
function addStudyFileReference(filePath) {
    if (!studyReferencedFiles.find(f => f.path === filePath)) {
        const fileInfo = studySubjectFiles.find(f => f.path === filePath);
        if (fileInfo) {
            studyReferencedFiles.push(fileInfo);
            renderStudyReferencedFiles();
        }
    }
    const modal = document.getElementById('study-file-picker-modal');
    if (modal) modal.remove();
}

// Add YouTube video reference
async function addYouTubeReference() {
    const urlInput = document.getElementById('youtube-url-input');
    const langSelect = document.getElementById('youtube-lang-select');
    const statusEl = document.getElementById('youtube-status');

    if (!urlInput || !urlInput.value.trim()) {
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#FF6B6B';
            statusEl.textContent = 'Please enter a YouTube URL';
        }
        return;
    }

    const url = urlInput.value.trim();
    const language = langSelect ? langSelect.value : 'auto';

    // Show loading
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#F59E0B';
        statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching transcript...';
    }

    try {
        const response = await fetch('/api/youtube-transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, language })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to get transcript');
        }

        // Add as a special YouTube reference
        const ytRef = {
            name: `YouTube: ${data.videoId}`,
            path: `youtube://${data.videoId}`,
            type: 'youtube',
            videoId: data.videoId,
            language: data.language,
            transcript: data.fullText,
            timestampedText: data.timestampedText,
            lineCount: data.lineCount
        };

        // Check if already added
        if (!studyReferencedFiles.find(f => f.path === ytRef.path)) {
            studyReferencedFiles.push(ytRef);
            renderStudyReferencedFiles();
        }

        // Close modal
        const modal = document.getElementById('study-file-picker-modal');
        if (modal) modal.remove();

    } catch (error) {
        console.error('YouTube transcript error:', error);
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.color = '#FF6B6B';
            statusEl.textContent = error.message || 'Failed to fetch transcript';
        }
    }
}

// Load chat history for current document
async function loadStudyHistory() {
    if (!studyCurrentDocument) return;

    try {
        const response = await fetch(`/api/chat-history?documentPath=${encodeURIComponent(studyCurrentDocument)}`);
        const data = await response.json();

        if (data.success && data.history && data.history.length > 0) {
            studyMessages = data.history.map(h => ({
                role: 'user',
                content: h.question
            })).concat(data.history.map(h => ({
                role: 'assistant',
                content: h.answer
            })));

            // Interleave messages properly
            studyMessages = [];
            data.history.forEach(h => {
                studyMessages.push({ role: 'user', content: h.question });
                studyMessages.push({ role: 'assistant', content: h.answer });
            });

            renderStudyMessages();
        }
    } catch (error) {
        console.error('Error loading study history:', error);
    }
}

// Render all messages
function renderStudyMessages() {
    const container = document.getElementById('study-messages');
    const emptyState = document.getElementById('study-empty-state');

    if (!container) return;

    if (studyMessages.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        container.innerHTML = '';
        container.appendChild(emptyState || createEmptyState());
        return;
    }

    if (emptyState) emptyState.style.display = 'none';

    container.innerHTML = studyMessages.map((msg, i) => {
        if (msg.role === 'user') {
            return `
                <div class="study-message user" data-index="${i}">
                    <div class="study-message-header">
                        <i class="fas fa-user"></i>
                        <span>You</span>
                    </div>
                    <div class="study-message-content">
                        ${escapeHtml(msg.content)}
                    </div>
                </div>
            `;
        } else if (msg.role === 'assistant') {
            // For assistant messages, show a compact card with View Slides button
            const title = extractSlideTitle(msg.content);
            const slideCount = countSlides(msg.content);
            return `
                <div class="study-message assistant-card" data-index="${i}">
                    <div class="assistant-card-content">
                        <div class="assistant-card-icon">
                            <i class="fas fa-chalkboard-teacher"></i>
                        </div>
                        <div class="assistant-card-info">
                            <div class="assistant-card-title">${escapeHtml(title)}</div>
                            <div class="assistant-card-meta">${slideCount} slide${slideCount !== 1 ? 's' : ''} available</div>
                        </div>
                        <button class="view-slides-btn" onclick="openMessageAsSlides(${i})">
                            <i class="fas fa-play-circle"></i> View Slides
                        </button>
                        <button class="save-slides-btn" onclick="saveSlides(${i})" title="Save to Slides Library">
                            <i class="fas fa-bookmark"></i>
                        </button>
                    </div>
                </div>
            `;
        } else {
            // Error message
            return `
                <div class="study-message error" data-index="${i}">
                    <div class="study-message-content">${escapeHtml(msg.content)}</div>
                </div>
            `;
        }
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Extract title from slide content
function extractSlideTitle(content) {
    // Look for first header
    const headerMatch = content.match(/^##?\s+(.+)$/m);
    if (headerMatch) return headerMatch[1].substring(0, 50);

    // Look for first line
    const firstLine = content.split('\n')[0];
    if (firstLine && firstLine.length < 60) return firstLine;

    return 'Study Slides';
}

// Count number of slides in content
function countSlides(content) {
    if (content.includes('---SLIDE---')) {
        return content.split('---SLIDE---').filter(s => s.trim()).length;
    }
    // Count headers as slides
    const headers = content.match(/^##\s+.+$/gm);
    return headers ? headers.length : 1;
}

// Open a specific message as slides
function openMessageAsSlides(messageIndex) {
    const msg = studyMessages[messageIndex];
    if (!msg || msg.role !== 'assistant') return;

    // Render the message content as slides
    if (msg.content.includes('---SLIDE---')) {
        renderStudySlides(msg.content, 'Response');
    } else {
        // Auto-split by headers
        const slidesContent = autoSplitIntoSlides(msg.content);
        renderStudySlides(slidesContent, 'Response');
    }
}

// Save slides to the database
async function saveSlides(messageIndex) {
    const msg = studyMessages[messageIndex];
    if (!msg || msg.role !== 'assistant') return;

    // Find the user question that generated this response
    let question = 'Study slides';
    for (let i = messageIndex - 1; i >= 0; i--) {
        if (studyMessages[i].role === 'user') {
            question = studyMessages[i].content;
            break;
        }
    }

    // Extract subject code from document path
    let subjectCode = 'general';

    // Try primary document first
    if (studyCurrentDocument) {
        const pathMatch = studyCurrentDocument.match(/subjects\/([^/]+)\//i);
        if (pathMatch) {
            subjectCode = pathMatch[1].toUpperCase();
        }
    }

    // If still general, try referenced files
    if (subjectCode === 'general' && studyReferencedFiles && studyReferencedFiles.length > 0) {
        for (const ref of studyReferencedFiles) {
            const refPath = ref.path || ref;
            const pathMatch = refPath.match(/subjects\/([^/]+)\//i);
            if (pathMatch) {
                subjectCode = pathMatch[1].toUpperCase();
                break;
            }
        }
    }

    // Also try currentLeftPDF and currentRightPDF as fallbacks
    if (subjectCode === 'general' && typeof currentLeftPDF !== 'undefined' && currentLeftPDF?.path) {
        const pathMatch = currentLeftPDF.path.match(/subjects\/([^/]+)\//i);
        if (pathMatch) {
            subjectCode = pathMatch[1].toUpperCase();
        }
    }

    // Extract title from content
    const defaultTitle = extractSlideTitle(msg.content);

    // Prompt user for title
    const title = prompt('Enter a title for these slides:', defaultTitle);
    if (!title) return; // User cancelled

    // Extract lecture number from document path
    let lectureNumber = null;
    if (studyCurrentDocument) {
        const lectureMatch = studyCurrentDocument.match(/lec(?:ture)?[-_]?(\d+)/i);
        if (lectureMatch) {
            lectureNumber = parseInt(lectureMatch[1]);
        }
    }

    try {
        const response = await fetch('/api/slides/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subjectCode: subjectCode,
                title: title,
                question: question.substring(0, 500), // Limit question length
                content: msg.content,
                sourceDocument: studyCurrentDocument || null,
                sourceType: studyCurrentDocument?.endsWith('.tex') ? 'tex' : 'pdf',
                lectureNumber: lectureNumber
            })
        });

        const data = await response.json();

        if (data.success) {
            // Show success notification
            showNotification('Slides saved successfully!', 'success');
            // Update button to show saved state
            const btn = document.querySelector(`.study-message[data-index="${messageIndex}"] .save-slides-btn`);
            if (btn) {
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.disabled = true;
                btn.title = 'Saved to Slides Library';
            }
        } else {
            showNotification('Failed to save slides: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error saving slides:', error);
        showNotification('Error saving slides: ' + error.message, 'error');
    }
}

// ============================================================================
// STUDY PANEL - SAVED SLIDES HISTORY TAB
// ============================================================================

let studyCurrentTab = 'chat';
let studySavedSlidesData = null;

// Switch between Chat and History tabs
function switchStudyTab(tab) {
    studyCurrentTab = tab;

    // Close slide view if it's open
    const slideView = document.getElementById('study-slide-view');
    if (slideView && slideView.classList.contains('active')) {
        slideView.classList.remove('active');
        slideView.innerHTML = '';
        cleanupStepVisualizers();
        document.removeEventListener('keydown', handleSlideKeydown);
        slidesData = [];
        currentSlideIndex = 0;
    }

    // Update tab buttons
    document.getElementById('study-tab-chat').classList.toggle('active', tab === 'chat');
    document.getElementById('study-tab-history').classList.toggle('active', tab === 'history');

    // Update panels visibility
    document.getElementById('study-panel-chat').style.display = tab === 'chat' ? 'flex' : 'none';
    document.getElementById('study-panel-history').style.display = tab === 'history' ? 'flex' : 'none';

    // Update references bar visibility (only in chat mode)
    const refsBar = document.getElementById('study-references-bar');
    if (refsBar) {
        refsBar.style.display = tab === 'chat' ? 'flex' : 'none';
    }

    // Update input area visibility (only in chat mode)
    const inputArea = document.querySelector('.study-input-area');
    if (inputArea) {
        inputArea.style.display = tab === 'chat' ? 'flex' : 'none';
    }

    // Load history when switching to history tab
    if (tab === 'history') {
        loadSavedSlides();
    }
}

// Load saved slides from database
async function loadSavedSlides() {
    const loadingEl = document.getElementById('study-history-loading');
    const emptyEl = document.getElementById('study-history-empty');
    const listEl = document.getElementById('study-history-list');

    if (loadingEl) loadingEl.style.display = 'flex';
    if (emptyEl) emptyEl.style.display = 'none';
    if (listEl) listEl.innerHTML = '';

    try {
        const response = await fetch('/api/slides');
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to load slides');
        }

        studySavedSlidesData = data.slidesBySubject;
        renderSavedSlides();

    } catch (error) {
        console.error('Error loading saved slides:', error);
        if (loadingEl) loadingEl.style.display = 'none';
        if (emptyEl) {
            emptyEl.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Error Loading Slides</h3>
                <p>${error.message}</p>
            `;
            emptyEl.style.display = 'flex';
        }
    }
}

// Render saved slides list
function renderSavedSlides() {
    const loadingEl = document.getElementById('study-history-loading');
    const emptyEl = document.getElementById('study-history-empty');
    const listEl = document.getElementById('study-history-list');

    if (loadingEl) loadingEl.style.display = 'none';

    if (!studySavedSlidesData || Object.keys(studySavedSlidesData).length === 0) {
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    let html = '';

    for (const [code, subject] of Object.entries(studySavedSlidesData)) {
        html += `
            <div class="study-history-subject">
                <div class="study-history-subject-header" style="border-left-color: ${subject.subjectColor}">
                    <i class="fas ${subject.subjectIcon}" style="color: ${subject.subjectColor}"></i>
                    <span class="subject-name">${subject.subjectName}</span>
                    <span class="subject-count">${subject.slides.length}</span>
                </div>
                <div class="study-history-slides">
        `;

        for (const slide of subject.slides) {
            const timeAgo = getStudyTimeAgo(slide.createdAt);
            const slideCount = countSlides(slide.content);

            html += `
                <div class="study-history-slide" data-slide-id="${slide.id}">
                    <div class="slide-info">
                        <div class="slide-title">${escapeHtml(slide.title)}</div>
                        ${slide.question ? `<div class="slide-question"><strong>Q:</strong> ${escapeHtml(slide.question.substring(0, 80))}${slide.question.length > 80 ? '...' : ''}</div>` : ''}
                        <div class="slide-meta">
                            <span><i class="fas fa-layer-group"></i> ${slideCount} slides</span>
                            <span class="time-ago">${timeAgo}</span>
                        </div>
                    </div>
                    <div class="slide-actions">
                        <button class="slide-view-btn" onclick="openSavedSlide(${slide.id})" title="View Slides">
                            <i class="fas fa-play-circle"></i>
                        </button>
                        <button class="slide-delete-btn" onclick="deleteSavedSlide(${slide.id}, event)" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        html += '</div></div>';
    }

    if (listEl) listEl.innerHTML = html;
}

// Get time ago string
function getStudyTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;

    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Open a saved slide in the slide viewer
async function openSavedSlide(id) {
    try {
        const response = await fetch(`/api/slides/view/${id}`);
        const data = await response.json();

        if (!data.success) throw new Error(data.error);

        const slide = data.slide;

        // Use the existing slide viewer
        if (slide.content.includes('---SLIDE---')) {
            renderStudySlides(slide.content, slide.title);
        } else {
            const slidesContent = autoSplitIntoSlides(slide.content);
            renderStudySlides(slidesContent, slide.title);
        }

    } catch (error) {
        console.error('Error loading slide:', error);
        showNotification('Error loading slide: ' + error.message, 'error');
    }
}

// Delete a saved slide
async function deleteSavedSlide(id, event) {
    event.stopPropagation();

    if (!confirm('Delete this saved slide? This cannot be undone.')) return;

    try {
        const response = await fetch(`/api/slides/${id}`, { method: 'DELETE' });
        const data = await response.json();

        if (!data.success) throw new Error(data.error);

        showNotification('Slide deleted', 'success');
        loadSavedSlides(); // Reload the list

    } catch (error) {
        console.error('Error deleting slide:', error);
        showNotification('Error deleting slide: ' + error.message, 'error');
    }
}

// Escape HTML for user messages
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================================
// SLIDE COMPONENT PARSER - Parse structured blocks into visual components
// ============================================================================

// Process markdown content for components (handles tables, lists, formatting)
function processInlineMarkdown(text) {
    if (!text) return '';

    // Use marked.js if available for full markdown support (tables, lists, etc.)
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true  // GitHub Flavored Markdown - includes tables
        });

        // Protect any existing HTML (like mermaid diagrams) from marked processing
        const htmlBlocks = [];
        let protectedText = text.replace(/<div[^>]*>[\s\S]*?<\/div>/gi, (match) => {
            htmlBlocks.push(match);
            return `<!--HTML_BLOCK_${htmlBlocks.length - 1}-->`;
        });

        // Protect LaTeX math from markdown processing
        const displayMathBlocks = [];
        protectedText = protectedText.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
            displayMathBlocks.push(math);
            return `%%DISPLAY_MATH_${displayMathBlocks.length - 1}%%`;
        });

        const inlineMathBlocks = [];
        protectedText = protectedText.replace(/\$([^\$\n]+?)\$/g, (match, math) => {
            inlineMathBlocks.push(math);
            return `%%INLINE_MATH_${inlineMathBlocks.length - 1}%%`;
        });

        // Parse markdown
        let result = marked.parse(protectedText);

        // Restore protected HTML blocks
        htmlBlocks.forEach((html, index) => {
            result = result.replace(`<!--HTML_BLOCK_${index}-->`, html);
            result = result.replace(`<p><!--HTML_BLOCK_${index}--></p>`, html);
        });

        // Restore and render KaTeX math
        if (typeof katex !== 'undefined') {
            result = result.replace(/%%DISPLAY_MATH_(\d+)%%/g, (match, index) => {
                const math = displayMathBlocks[parseInt(index)];
                try {
                    return '<div class="katex-display">' + katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) + '</div>';
                } catch (e) {
                    return '$$' + math + '$$';
                }
            });

            result = result.replace(/%%INLINE_MATH_(\d+)%%/g, (match, index) => {
                const math = inlineMathBlocks[parseInt(index)];
                try {
                    return katex.renderToString(math.trim(), { throwOnError: false });
                } catch (e) {
                    return '$' + math + '$';
                }
            });
        } else {
            // Just restore without rendering
            result = result.replace(/%%DISPLAY_MATH_(\d+)%%/g, (match, index) => '$$' + displayMathBlocks[parseInt(index)] + '$$');
            result = result.replace(/%%INLINE_MATH_(\d+)%%/g, (match, index) => '$' + inlineMathBlocks[parseInt(index)] + '$');
        }

        return result;
    }

    // Fallback: basic processing without marked
    let result = text;

    // Protect and render LaTeX math
    const displayMathBlocks = [];
    result = result.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
        displayMathBlocks.push(math);
        return `%%DISPLAY_MATH_${displayMathBlocks.length - 1}%%`;
    });

    const inlineMathBlocks = [];
    result = result.replace(/\$([^\$\n]+?)\$/g, (match, math) => {
        inlineMathBlocks.push(math);
        return `%%INLINE_MATH_${inlineMathBlocks.length - 1}%%`;
    });

    // Process numbered lists (1. item, 2. item, etc.)
    result = result.replace(/(?:^|\n)((?:\d+\.\s+[^\n]+\n?)+)/g, (match, listBlock) => {
        const items = listBlock.trim().split('\n')
            .filter(line => /^\d+\.\s+/.test(line))
            .map(line => {
                const content = line.replace(/^\d+\.\s+/, '').trim();
                return `<li>${content}</li>`;
            });
        return items.length ? `<ol class="pe-list">${items.join('')}</ol>` : match;
    });

    // Process bullet lists (- item or * item)
    result = result.replace(/(?:^|\n)((?:[-*]\s+[^\n]+\n?)+)/g, (match, listBlock) => {
        const items = listBlock.trim().split('\n')
            .filter(line => /^[-*]\s+/.test(line))
            .map(line => {
                const content = line.replace(/^[-*]\s+/, '').trim();
                return `<li>${content}</li>`;
            });
        return items.length ? `<ul class="pe-list">${items.join('')}</ul>` : match;
    });

    // Bold **text**
    result = result.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    result = result.replace(/(?<!^|\s)\*([^*\n]+)\*(?![\s*])/g, '<em>$1</em>');
    // Inline code `code`
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links [text](url)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Restore and render KaTeX math
    if (typeof katex !== 'undefined') {
        result = result.replace(/%%DISPLAY_MATH_(\d+)%%/g, (match, index) => {
            const math = displayMathBlocks[parseInt(index)];
            try {
                return '<div class="katex-display">' + katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) + '</div>';
            } catch (e) {
                return '$$' + math + '$$';
            }
        });

        result = result.replace(/%%INLINE_MATH_(\d+)%%/g, (match, index) => {
            const math = inlineMathBlocks[parseInt(index)];
            try {
                return katex.renderToString(math.trim(), { throwOnError: false });
            } catch (e) {
                return '$' + math + '$';
            }
        });
    } else {
        result = result.replace(/%%DISPLAY_MATH_(\d+)%%/g, (match, index) => '$$' + displayMathBlocks[parseInt(index)] + '$$');
        result = result.replace(/%%INLINE_MATH_(\d+)%%/g, (match, index) => '$' + inlineMathBlocks[parseInt(index)] + '$');
    }

    return result;
}

// ============================================================================
// INTUITION IMAGE GENERATION - Local SDXL Turbo
// ============================================================================

const intuitionImageQueue = [];
let isGeneratingIntuitionImage = false;

/**
 * Queue an intuition image for generation
 */
function queueIntuitionImageGeneration(imageId, prompt, aspect) {
    intuitionImageQueue.push({ imageId, prompt, aspect });
    // Use setTimeout to avoid blocking the render
    setTimeout(() => processIntuitionImageQueue(), 100);
}

/**
 * Process the intuition image queue one at a time
 */
async function processIntuitionImageQueue() {
    if (isGeneratingIntuitionImage || intuitionImageQueue.length === 0) return;

    isGeneratingIntuitionImage = true;
    const { imageId, prompt, aspect } = intuitionImageQueue.shift();

    const container = document.getElementById(imageId);
    if (!container) {
        isGeneratingIntuitionImage = false;
        processIntuitionImageQueue();
        return;
    }

    try {
        const response = await fetch('/api/generate-intuition-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, aspect })
        });

        const data = await response.json();

        if (data.success && container) {
            container.innerHTML = `
                <img src="${data.imagePath}" alt="${escapeHtml(prompt)}" class="intuition-image-result" loading="lazy">
                <div class="intuition-image-caption">
                    <i class="fas fa-lightbulb"></i> ${escapeHtml(prompt)}
                </div>
            `;
            container.classList.add('loaded');
        } else if (container) {
            container.innerHTML = `
                <div class="intuition-image-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Image generation failed</span>
                    <small>${escapeHtml(data.error || 'Unknown error')}</small>
                </div>
            `;
            container.classList.add('error');
        }
    } catch (error) {
        console.error('Intuition image generation error:', error);
        if (container) {
            container.innerHTML = `
                <div class="intuition-image-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Image generation failed</span>
                    <small>Network or server error</small>
                </div>
            `;
            container.classList.add('error');
        }
    }

    isGeneratingIntuitionImage = false;
    // Continue processing queue
    processIntuitionImageQueue();
}

function parseSlideComponents(text) {
    if (!text) return '';

    let result = text;

    // Parse :::definition{term="..."} ... :::
    result = result.replace(/:::definition\{term="([^"]+)"\}\n?([\s\S]*?):::/g, (match, term, content) => {
        return `<div class="slide-component definition">
            <div class="definition-label">DEFINITION</div>
            <span class="term">${escapeHtml(term)}</span>
            <div class="meaning">${processInlineMarkdown(content.trim())}</div>
        </div>`;
    });

    // Parse :::example{title="..."} ... :::
    result = result.replace(/:::example\{title="([^"]+)"\}\n([\s\S]*?):::/g, (match, title, content) => {
        return `<div class="slide-component example">
            <div class="example-title">${escapeHtml(title)}</div>
            <div class="example-content">${processInlineMarkdown(content.trim())}</div>
        </div>`;
    });

    // Parse :::example without title
    result = result.replace(/:::example\n([\s\S]*?):::/g, (match, content) => {
        return `<div class="slide-component example">
            <div class="example-content">${processInlineMarkdown(content.trim())}</div>
        </div>`;
    });

    // Parse :::keypoint{title="..."} ... :::
    result = result.replace(/:::keypoint\{title="([^"]+)"\}\n([\s\S]*?):::/g, (match, title, content) => {
        return `<div class="slide-component keypoint">
            <div class="keypoint-content">
                <div class="keypoint-title">${escapeHtml(title)}</div>
                <div class="keypoint-text">${processInlineMarkdown(content.trim())}</div>
            </div>
        </div>`;
    });

    // Parse :::keypoint without title
    result = result.replace(/:::keypoint\n([\s\S]*?):::/g, (match, content) => {
        return `<div class="slide-component keypoint">
            <div class="keypoint-content">
                <div class="keypoint-text">${processInlineMarkdown(content.trim())}</div>
            </div>
        </div>`;
    });

    // Parse :::formula{label="..."} with variables section
    result = result.replace(/:::formula\{label="([^"]+)"\}\n([\s\S]*?):::variables\n([\s\S]*?):::/g, (match, label, equation, variables) => {
        const varsHtml = variables.trim().split('\n').map(v => {
            const parts = v.split(':');
            if (parts.length >= 2) {
                return `<span class="variable"><code>${parts[0].trim()}</code>: ${parts.slice(1).join(':').trim()}</span>`;
            }
            return '';
        }).filter(v => v).join('');

        return `<div class="slide-component formula">
            <div class="formula-label">${escapeHtml(label)}</div>
            <div class="formula-equation">${equation.trim()}</div>
            <div class="formula-variables">${varsHtml}</div>
        </div>`;
    });

    // Parse :::formula without variables
    result = result.replace(/:::formula\{label="([^"]+)"\}\n([\s\S]*?):::/g, (match, label, equation) => {
        return `<div class="slide-component formula">
            <div class="formula-label">${escapeHtml(label)}</div>
            <div class="formula-equation">${equation.trim()}</div>
        </div>`;
    });

    // Parse :::formula without label
    result = result.replace(/:::formula\n([\s\S]*?):::/g, (match, equation) => {
        return `<div class="slide-component formula">
            <div class="formula-equation">${equation.trim()}</div>
        </div>`;
    });

    // Parse :::code{lang="..." filename="..."} ... :::
    result = result.replace(/:::code\{lang="([^"]*)"(?:\s+filename="([^"]*)")?\}\n([\s\S]*?):::/g, (match, lang, filename, code) => {
        const langIcons = {
            'sql': '<i class="fas fa-database"></i>',
            'python': '<i class="fab fa-python"></i>',
            'javascript': '<i class="fab fa-js"></i>',
            'js': '<i class="fab fa-js"></i>',
            'java': '<i class="fab fa-java"></i>',
            'c': '<i class="fas fa-cog"></i>',
            'cpp': '<i class="fas fa-cog"></i>',
            'rust': '<i class="fas fa-cog"></i>',
            'go': '<i class="fas fa-cog"></i>',
            'typescript': '<i class="fas fa-code"></i>',
            'ts': '<i class="fas fa-code"></i>',
            'html': '<i class="fab fa-html5"></i>',
            'css': '<i class="fab fa-css3-alt"></i>',
            'bash': '<i class="fas fa-terminal"></i>',
            'shell': '<i class="fas fa-terminal"></i>',
            'latex': '<i class="fas fa-file-alt"></i>'
        };
        const icon = langIcons[lang.toLowerCase()] || '<i class="fas fa-file-code"></i>';
        const filenameHtml = filename ? `<span class="code-filename">${escapeHtml(filename)}</span>` : '';

        return `<div class="slide-component code">
            <div class="code-header">
                <div class="code-lang">${icon} ${lang.toUpperCase()}</div>
                ${filenameHtml}
                <button class="code-copy-btn" onclick="copySlideCode(this)"><i class="fas fa-copy"></i> Copy</button>
            </div>
            <div class="code-body">
                <pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>
            </div>
        </div>`;
    });

    // Parse :::steps{title="..."} with numbered steps
    result = result.replace(/:::steps\{title="([^"]+)"\}\n([\s\S]*?):::/g, (match, title, content) => {
        const steps = content.trim().split('\n').filter(l => l.trim());
        let stepsHtml = '';
        steps.forEach((step, i) => {
            // Parse "Step text | Description" or just "Step text"
            const parts = step.replace(/^\d+\.\s*/, '').split('|');
            const stepTitle = parts[0].trim();
            const stepDesc = parts[1] ? parts[1].trim() : '';
            stepsHtml += `
                <div class="step">
                    <div class="step-number">${i + 1}</div>
                    <div class="step-content">
                        <div class="step-title">${processInlineMarkdown(stepTitle)}</div>
                        ${stepDesc ? `<div class="step-desc">${processInlineMarkdown(stepDesc)}</div>` : ''}
                    </div>
                </div>`;
        });

        return `<div class="slide-component steps">
            <div class="steps-title">${escapeHtml(title)}</div>
            ${stepsHtml}
        </div>`;
    });

    // Parse :::steps without title
    result = result.replace(/:::steps\n([\s\S]*?):::/g, (match, content) => {
        const steps = content.trim().split('\n').filter(l => l.trim());
        let stepsHtml = '';
        steps.forEach((step, i) => {
            const parts = step.replace(/^\d+\.\s*/, '').split('|');
            const stepTitle = parts[0].trim();
            const stepDesc = parts[1] ? parts[1].trim() : '';
            stepsHtml += `
                <div class="step">
                    <div class="step-number">${i + 1}</div>
                    <div class="step-content">
                        <div class="step-title">${processInlineMarkdown(stepTitle)}</div>
                        ${stepDesc ? `<div class="step-desc">${processInlineMarkdown(stepDesc)}</div>` : ''}
                    </div>
                </div>`;
        });

        return `<div class="slide-component steps">${stepsHtml}</div>`;
    });

    // Parse :::intuition-image{prompt="..." aspect="..."} ::: - AI-generated visual metaphors
    result = result.replace(/:::intuition-image\{([^}]*)\}\s*:::/g, (match, attrs) => {
        const promptMatch = attrs.match(/prompt="([^"]*)"/);
        const aspectMatch = attrs.match(/aspect="([^"]*)"/);

        const prompt = promptMatch ? promptMatch[1] : '';
        const aspect = aspectMatch ? aspectMatch[1] : 'square';

        if (!prompt) return '';

        // Generate unique ID for this image
        const imageId = 'intuition-' + Math.random().toString(36).substr(2, 9);

        // Queue the image generation (async, will update the container when done)
        queueIntuitionImageGeneration(imageId, prompt, aspect);

        // Determine aspect ratio class
        const aspectClass = aspect === 'wide' ? 'aspect-wide' :
                            aspect === 'tall' ? 'aspect-tall' : 'aspect-square';

        // Return placeholder with loading state
        return `<div class="slide-component intuition-image ${aspectClass}" id="${imageId}">
            <div class="intuition-image-loading">
                <div class="intuition-loading-spinner"></div>
                <div class="intuition-loading-text">Generating intuition image...</div>
                <div class="intuition-prompt-preview">${escapeHtml(prompt)}</div>
            </div>
        </div>`;
    });

    // Parse :::stepviz{title="..." speed="..."} - Immersive Animated Step Visualizer
    result = result.replace(/:::stepviz(?:\{([^}]*)\})?\n([\s\S]*?):::/g, (match, attrs, content) => {
        attrs = attrs || '';

        // Parse attributes
        const titleMatch = attrs.match(/title="([^"]*)"/);
        const speedMatch = attrs.match(/speed="(\d+)"/);
        const autoplayMatch = attrs.match(/autoplay="(true|false)"/);

        const title = titleMatch ? titleMatch[1] : '';
        const speed = speedMatch ? parseInt(speedMatch[1]) : 2500;
        const autoplay = autoplayMatch ? autoplayMatch[1] === 'true' : false;

        // Generate unique ID
        const vizId = 'stepviz-' + Math.random().toString(36).substr(2, 9);

        // Parse steps
        const steps = content.trim().split('\n').filter(l => l.trim());
        let cardsHtml = '';
        let overviewHtml = '';
        let dotsHtml = '';

        steps.forEach((step, i) => {
            const parts = step.replace(/^\d+\.\s*/, '').split('|');
            const stepTitle = parts[0].trim();
            const stepDesc = parts[1] ? parts[1].trim() : '';

            // Focus mode: Step cards (shown one at a time)
            cardsHtml += `
                <div class="stepviz-card ${i === 0 ? 'active' : ''}" data-step="${i}">
                    <div class="stepviz-card-number">${i + 1}</div>
                    <div class="stepviz-card-content">
                        <div class="stepviz-card-title">${processInlineMarkdown(stepTitle)}</div>
                        ${stepDesc ? `<div class="stepviz-card-desc">${processInlineMarkdown(stepDesc)}</div>` : ''}
                    </div>
                </div>`;

            // Overview mode: All steps visible
            overviewHtml += `
                <div class="stepviz-overview-item ${i === 0 ? 'active' : ''}" data-step="${i}" onclick="stepVizGoTo('${vizId}', ${i}); stepVizSetMode('${vizId}', 'focus');">
                    <div class="stepviz-overview-number">${i + 1}</div>
                    <div class="stepviz-overview-content">
                        <div class="stepviz-overview-title">${processInlineMarkdown(stepTitle)}</div>
                        ${stepDesc ? `<div class="stepviz-overview-desc">${processInlineMarkdown(stepDesc)}</div>` : ''}
                    </div>
                </div>`;

            // Mini dots for navigation
            dotsHtml += `<div class="stepviz-dot ${i === 0 ? 'active' : ''} ${i === 0 ? 'current' : ''}" data-step="${i}" onclick="stepVizGoTo('${vizId}', ${i})"></div>`;
        });

        return `<div class="slide-component stepviz-immersive" id="${vizId}"
                     data-speed="${speed}" data-autoplay="${autoplay}" data-total="${steps.length}" data-current="0" data-mode="focus">
            <div class="stepviz-im-header">
                ${title ? `<i class="fas fa-stream"></i><span>${escapeHtml(title)}</span>` : '<i class="fas fa-stream"></i><span>Process Steps</span>'}
                <button class="stepviz-mode-toggle" onclick="stepVizToggleMode('${vizId}')" title="Toggle Overview (O)">
                    <i class="fas fa-th-list"></i>
                </button>
            </div>
            <div class="stepviz-im-stage">
                <div class="stepviz-cards-container">${cardsHtml}</div>
                <div class="stepviz-overview-container">${overviewHtml}</div>
            </div>
            <div class="stepviz-im-footer">
                <div class="stepviz-im-controls">
                    <button class="stepviz-im-btn" onclick="stepVizPrev('${vizId}')" title="Previous (↑)">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                    <button class="stepviz-im-btn stepviz-im-play" onclick="stepVizTogglePlay('${vizId}')" title="Play/Pause (Space)">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="stepviz-im-btn" onclick="stepVizNext('${vizId}')" title="Next (↓)">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </div>
                <div class="stepviz-im-dots">${dotsHtml}</div>
                <div class="stepviz-im-progress">
                    <div class="stepviz-im-progress-fill" style="width: ${100 / steps.length}%"></div>
                </div>
            </div>
        </div>`;
    });

    // Parse :::comparison with LEFT: and RIGHT: sections
    result = result.replace(/:::comparison\nLEFT:\s*([^\n]+)\n([\s\S]*?)RIGHT:\s*([^\n]+)\n([\s\S]*?):::/g,
        (match, leftTitle, leftContent, rightTitle, rightContent) => {
        return `<div class="slide-component comparison">
            <div class="compare-card left">
                <div class="compare-header">${escapeHtml(leftTitle)}</div>
                <div class="compare-body">${processInlineMarkdown(leftContent.trim())}</div>
            </div>
            <div class="compare-card right">
                <div class="compare-header">${escapeHtml(rightTitle)}</div>
                <div class="compare-body">${processInlineMarkdown(rightContent.trim())}</div>
            </div>
        </div>`;
    });

    // Parse :::theorem{name="..."} with optional :::proof section
    result = result.replace(/:::theorem\{name="([^"]+)"\}\n([\s\S]*?):::proof\n([\s\S]*?):::/g,
        (match, name, statement, proof) => {
        return `<div class="slide-component theorem">
            <div class="theorem-header">
                <span class="theorem-badge">Theorem</span>
                <span class="theorem-name">${escapeHtml(name)}</span>
            </div>
            <div class="theorem-statement">${processInlineMarkdown(statement.trim())}</div>
            <div class="theorem-proof">
                <div class="proof-label">Proof</div>
                <div class="proof-content">${processInlineMarkdown(proof.trim())}</div>
            </div>
        </div>`;
    });

    // Parse :::theorem without proof
    result = result.replace(/:::theorem\{name="([^"]+)"\}\n([\s\S]*?):::/g, (match, name, statement) => {
        return `<div class="slide-component theorem">
            <div class="theorem-header">
                <span class="theorem-badge">Theorem</span>
                <span class="theorem-name">${escapeHtml(name)}</span>
            </div>
            <div class="theorem-statement">${processInlineMarkdown(statement.trim())}</div>
        </div>`;
    });

    // Parse :::callout{type="..." title="..."} ... :::
    result = result.replace(/:::callout\{type="([^"]+)"(?:\s+title="([^"]*)")?\}\n([\s\S]*?):::/g,
        (match, type, title, content) => {
        const icons = {
            'note': '<i class="fas fa-info-circle"></i>',
            'warning': '<i class="fas fa-exclamation-triangle"></i>',
            'tip': '<i class="fas fa-lightbulb"></i>',
            'danger': '<i class="fas fa-times-circle"></i>'
        };
        const defaultTitles = {
            'note': 'Note',
            'warning': 'Warning',
            'tip': 'Tip',
            'danger': 'Important'
        };
        const icon = icons[type] || icons['note'];
        const displayTitle = title || defaultTitles[type] || 'Note';

        return `<div class="slide-component callout ${type}">
            <div class="callout-icon">${icon}</div>
            <div class="callout-content">
                <div class="callout-title">${escapeHtml(displayTitle)}</div>
                <div class="callout-text">${processInlineMarkdown(content.trim())}</div>
            </div>
        </div>`;
    });

    // Parse :::note, :::warning, :::tip, :::danger shortcuts
    ['note', 'warning', 'tip', 'danger'].forEach(type => {
        const regex = new RegExp(`:::${type}\\n([\\s\\S]*?):::`, 'g');
        result = result.replace(regex, (match, content) => {
            const icons = {
                'note': '<i class="fas fa-info-circle"></i>',
                'warning': '<i class="fas fa-exclamation-triangle"></i>',
                'tip': '<i class="fas fa-lightbulb"></i>',
                'danger': '<i class="fas fa-times-circle"></i>'
            };
            const titles = {
                'note': 'Note',
                'warning': 'Warning',
                'tip': 'Tip',
                'danger': 'Important'
            };
            return `<div class="slide-component callout ${type}">
                <div class="callout-icon">${icons[type]}</div>
                <div class="callout-content">
                    <div class="callout-title">${titles[type]}</div>
                    <div class="callout-text">${processInlineMarkdown(content.trim())}</div>
                </div>
            </div>`;
        });
    });

    // Parse :::table{title="..."} with markdown table inside
    result = result.replace(/:::table\{title="([^"]+)"\}\n([\s\S]*?):::/g, (match, title, tableContent) => {
        return `<div class="slide-component table">
            <div class="table-title">${escapeHtml(title)}</div>
            ${tableContent.trim()}
        </div>`;
    });

    // Parse :::table without title
    result = result.replace(/:::table\n([\s\S]*?):::/g, (match, tableContent) => {
        return `<div class="slide-component table">${tableContent.trim()}</div>`;
    });

    // Parse :::summary with bullet points
    result = result.replace(/:::summary\{title="([^"]+)"\}\n([\s\S]*?):::/g, (match, title, content) => {
        const points = content.trim().split('\n')
            .filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'))
            .map(l => l.replace(/^[\-\*]\s*/, '').trim());

        const pointsHtml = points.map(p => `<div class="summary-point"><span class="point-icon"><i class="fas fa-check-circle"></i></span><span class="point-text">${processInlineMarkdown(p)}</span></div>`).join('');

        return `<div class="slide-component summary">
            <div class="summary-header">
                <span class="summary-icon"><i class="fas fa-clipboard-list"></i></span>
                <span class="summary-title">${escapeHtml(title)}</span>
            </div>
            <div class="summary-points">${pointsHtml}</div>
        </div>`;
    });

    // Parse :::summary without title
    result = result.replace(/:::summary\n([\s\S]*?):::/g, (match, content) => {
        const points = content.trim().split('\n')
            .filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'))
            .map(l => l.replace(/^[\-\*]\s*/, '').trim());

        const pointsHtml = points.map(p => `<div class="summary-point"><span class="point-icon"><i class="fas fa-check-circle"></i></span><span class="point-text">${processInlineMarkdown(p)}</span></div>`).join('');

        return `<div class="slide-component summary">
            <div class="summary-header">
                <span class="summary-icon"><i class="fas fa-clipboard-list"></i></span>
                <span class="summary-title">Key Takeaways</span>
            </div>
            <div class="summary-points">${pointsHtml}</div>
        </div>`;
    });

    // Parse :::quiz{question="..." correct="X" explanation="..."} with options A:, B:, C:, D:
    result = result.replace(/:::quiz\{([^}]*(?:"[^"]*"[^}]*)*)\}\n?([\s\S]*?):::/g, (match, attrs, options) => {
        // Parse attributes - handle quoted strings properly
        const questionMatch = attrs.match(/question="([^"]*)"/);
        const correctMatch = attrs.match(/correct="([A-D])"/);
        const explanationMatch = attrs.match(/explanation="([^"]*)"/);

        const question = questionMatch ? questionMatch[1] : 'Question';
        const correctAnswer = correctMatch ? correctMatch[1] : 'A';
        const explanation = explanationMatch ? explanationMatch[1] : '';

        const optionLines = options.trim().split('\n').filter(l => /^[A-D]:/.test(l.trim()));
        const optionsHtml = optionLines.map(opt => {
            const letter = opt.trim()[0];
            const text = opt.trim().substring(2).trim();
            return `<div class="quiz-option" data-option="${letter}" onclick="selectQuizOption(this)">
                <span class="option-letter">${letter}</span>
                <span class="option-text">${processInlineMarkdown(text)}</span>
            </div>`;
        }).join('');

        return `<div class="slide-component quiz" data-correct-answer="${correctAnswer}" data-explanation="${escapeHtml(explanation)}">
            <div class="quiz-header">
                <span class="quiz-icon"><i class="fas fa-question-circle"></i></span>
                <span class="quiz-label">Quick Check</span>
            </div>
            <div class="quiz-question">${escapeHtml(question)}</div>
            <div class="quiz-options">${optionsHtml}</div>
        </div>`;
    });

    // Parse :::diagram{title="..."} ... :::
    result = result.replace(/:::diagram\{title="([^"]+)"\}\n([\s\S]*?):::/g, (match, title, content) => {
        return `<div class="slide-component diagram">
            <div class="diagram-title">${escapeHtml(title)}</div>
            <div class="diagram-content">${escapeHtml(content.trim())}</div>
        </div>`;
    });

    // Parse :::diagram without title
    result = result.replace(/:::diagram\n([\s\S]*?):::/g, (match, content) => {
        return `<div class="slide-component diagram">
            <div class="diagram-content">${escapeHtml(content.trim())}</div>
        </div>`;
    });

    // Parse :::grid for multiple items
    result = result.replace(/:::grid\n([\s\S]*?):::/g, (match, content) => {
        // Parse items in format: ICON: Title | Description
        const items = content.trim().split('\n').filter(l => l.includes('|'));
        const itemsHtml = items.map(item => {
            const parts = item.split('|');
            const iconTitle = parts[0].trim();
            const desc = parts[1] ? parts[1].trim() : '';
            const iconMatch = iconTitle.match(/^(.+?):\s*(.+)$/);
            const icon = iconMatch ? iconMatch[1].trim() : '<i class="fas fa-cube"></i>';
            const title = iconMatch ? iconMatch[2].trim() : iconTitle;

            return `<div class="grid-item">
                <div class="grid-icon">${icon}</div>
                <div class="grid-title">${title}</div>
                <div class="grid-desc">${desc}</div>
            </div>`;
        }).join('');

        return `<div class="slide-component grid">${itemsHtml}</div>`;
    });

    // Parse :::diagram{title="..." type="flowchart"} with Mermaid.js code
    result = result.replace(/:::diagram\{([^}]*)\}\n?([\s\S]*?):::/g, (match, attrs, mermaidCode) => {
        const titleMatch = attrs.match(/title="([^"]*)"/);
        const typeMatch = attrs.match(/type="([^"]*)"/);
        const title = titleMatch ? titleMatch[1] : 'Diagram';
        const type = typeMatch ? typeMatch[1] : 'flowchart';

        const typeIcons = {
            'flowchart': '<i class="fas fa-project-diagram"></i>',
            'sequence': '<i class="fas fa-exchange-alt"></i>',
            'class': '<i class="fas fa-sitemap"></i>',
            'state': '<i class="fas fa-random"></i>',
            'er': '<i class="fas fa-database"></i>',
            'mindmap': '<i class="fas fa-brain"></i>',
            'gantt': '<i class="fas fa-calendar-alt"></i>',
            'pie': '<i class="fas fa-chart-pie"></i>',
            'journey': '<i class="fas fa-route"></i>'
        };
        const icon = typeIcons[type.toLowerCase()] || '<i class="fas fa-project-diagram"></i>';

        // Generate unique ID for this diagram
        const diagramId = 'mermaid-' + Math.random().toString(36).substr(2, 9);
        // Base64 encode mermaid code to protect from markdown processing
        const encodedMermaid = btoa(unescape(encodeURIComponent(mermaidCode.trim())));

        return `<div class="slide-component diagram">
            <div class="diagram-header">
                <span class="diagram-icon">${icon}</span>
                <span class="diagram-title">${escapeHtml(title)}</span>
                <span class="diagram-type">${type.toUpperCase()}</span>
            </div>
            <div class="diagram-container">
                <div class="mermaid-diagram" id="${diagramId}" data-mermaid-encoded="${encodedMermaid}"><pre>${escapeHtml(mermaidCode.trim())}</pre></div>
            </div>
        </div>`;
    });

    // Parse :::plainenglish{title="..." difficulty="simple|intermediate|advanced"}
    result = result.replace(/:::plainenglish\{([^}]*)\}\n?([\s\S]*?):::/g, (match, attrs, content) => {
        const titleMatch = attrs.match(/title="([^"]*)"/);
        const difficultyMatch = attrs.match(/difficulty="([^"]*)"/);
        const title = titleMatch ? titleMatch[1] : 'Plain English Explanation';
        const difficulty = difficultyMatch ? difficultyMatch[1] : 'simple';

        const difficultyConfig = {
            'simple': { icon: '<i class="fas fa-circle" style="color: #10B981; font-size: 10px;"></i>', label: 'Easy', color: '#10B981' },
            'intermediate': { icon: '<i class="fas fa-circle" style="color: #F59E0B; font-size: 10px;"></i>', label: 'Medium', color: '#F59E0B' },
            'advanced': { icon: '<i class="fas fa-circle" style="color: #EF4444; font-size: 10px;"></i>', label: 'Advanced', color: '#EF4444' }
        };
        const config = difficultyConfig[difficulty.toLowerCase()] || difficultyConfig.simple;

        // Process content sections
        let processedContent = processInlineMarkdown(content.trim());

        // Style section headers: **The Big Idea:**, **Step by Step:**, etc.
        processedContent = processedContent.replace(/<strong>([^<]+):<\/strong>/g,
            '<div class="pe-section-header">$1</div>');

        // Style numbered lists within Step by Step
        processedContent = processedContent.replace(/(\d+)\.\s+([^\n]+)/g,
            '<div class="pe-step"><span class="pe-step-number">$1</span><span class="pe-step-text">$2</span></div>');

        return `<div class="slide-component plainenglish" data-difficulty="${difficulty}">
            <div class="pe-header">
                <div class="pe-header-left">
                    <span class="pe-icon"><i class="fas fa-book-open"></i></span>
                    <span class="pe-title">${escapeHtml(title)}</span>
                </div>
                <div class="pe-difficulty" style="--difficulty-color: ${config.color}">
                    ${config.icon} ${config.label}
                </div>
            </div>
            <div class="pe-content">${processedContent}</div>
        </div>`;
    });

    // Parse :::flashcard
    result = result.replace(/:::flashcard\{([^}]*)\}\n?([\s\S]*?):::/g, (match, attrs, content) => {
        const topicMatch = attrs.match(/topic="([^"]+)"/);
        const topic = topicMatch ? topicMatch[1] : 'Flashcard';

        const frontMatch = content.match(/FRONT:\s*([\s\S]*?)(?=BACK:|HINT:|$)/);
        const backMatch = content.match(/BACK:\s*([\s\S]*?)(?=HINT:|$)/);
        const hintMatch = content.match(/HINT:\s*([\s\S]*?)$/);

        const front = frontMatch ? frontMatch[1].trim() : '';
        const back = backMatch ? backMatch[1].trim() : '';
        const hint = hintMatch ? hintMatch[1].trim() : '';

        const cardId = 'fc-' + Math.random().toString(36).substr(2, 9);

        return `
        <div class="flashcard-container" id="${cardId}">
            <div class="flashcard-topic">${escapeHtml(topic)}</div>
            <div class="flashcard" onclick="flipFlashcard('${cardId}')">
                <div class="flashcard-inner">
                    <div class="flashcard-front">
                        <div class="flashcard-label">Question</div>
                        <div class="flashcard-content">${processInlineMarkdown(front)}</div>
                        ${hint ? `<div class="flashcard-hint"><i class="fas fa-lightbulb"></i> ${escapeHtml(hint)}</div>` : ''}
                    </div>
                    <div class="flashcard-back">
                        <div class="flashcard-label">Answer</div>
                        <div class="flashcard-content">${processInlineMarkdown(back)}</div>
                    </div>
                </div>
            </div>
            <div class="flashcard-instruction">Click to flip</div>
        </div>`;
    });

    // Parse :::trace - Interactive Code Tracer Modal (BULLETPROOF VERSION)
    result = result.replace(/:::trace\{([^}]*)\}\n?([\s\S]*?):::/g, (match, attrs, content) => {
        try {
            // Parse attributes with fallbacks
            const titleMatch = attrs.match(/title="([^"]+)"/);
            const langMatch = attrs.match(/lang="([^"]+)"/);
            const title = titleMatch ? titleMatch[1] : 'Code Tracer';
            const lang = langMatch ? langMatch[1] : 'pseudocode';

            // Parse CODE: section - handle various formats
            const codeMatch = content.match(/CODE:\s*\n?([\s\S]*?)(?=\n\s*STEPS:|$)/i);
            const code = codeMatch ? codeMatch[1].trim() : '';

            // Fallback: if no CODE section, try to extract code block
            if (!code) {
                console.warn('[CodeTracer] No CODE section found in trace component');
                return `<div class="trace-error"><i class="fas fa-exclamation-triangle"></i> Code Tracer: Missing CODE section</div>`;
            }

            // Parse STEPS: table - handle various formats
            const stepsMatch = content.match(/STEPS:\s*\n?([\s\S]*?)$/i);
            if (!stepsMatch) {
                console.warn('[CodeTracer] No STEPS section found in trace component');
                return `<div class="trace-error"><i class="fas fa-exclamation-triangle"></i> Code Tracer: Missing STEPS section</div>`;
            }

            const stepsContent = stepsMatch[1].trim();
            const tableLines = stepsContent.split('\n').filter(line => line.trim().startsWith('|'));

            if (tableLines.length < 2) {
                console.warn('[CodeTracer] Invalid or empty STEPS table');
                return `<div class="trace-error"><i class="fas fa-exclamation-triangle"></i> Code Tracer: Invalid STEPS table format</div>`;
            }

            // Parse headers - handle edge cases
            const rawHeaders = tableLines[0].split('|').filter(h => h.trim()).map(h => h.trim());
            const headers = rawHeaders.length > 0 ? rawHeaders : ['Line', 'State', 'Action'];

            // Parse step rows - skip separator lines (containing only dashes)
            const dataLines = tableLines.slice(1).filter(line =>
                line.trim().startsWith('|') &&
                !line.match(/^\|[\s\-:|\+]+\|?$/)
            );

            const codeLines = code.split('\n');
            const maxLineNum = codeLines.length;

            const steps = dataLines.map((line, idx) => {
                try {
                    const cells = line.split('|').filter(c => c !== '').map(c => c.trim());
                    const lineNum = parseInt(cells[0]) || 1;

                    // Validate line number is within code bounds
                    const validLineNum = Math.max(1, Math.min(lineNum, maxLineNum));
                    if (lineNum !== validLineNum) {
                        console.warn(`[CodeTracer] Step ${idx + 1}: Line ${lineNum} adjusted to ${validLineNum} (code has ${maxLineNum} lines)`);
                    }

                    return {
                        line: validLineNum,
                        vars: headers.slice(1, -1).map((h, i) => ({
                            name: h,
                            value: (cells[i + 1] !== undefined && cells[i + 1] !== '') ? cells[i + 1] : '-'
                        })),
                        action: cells[cells.length - 1] || 'No description'
                    };
                } catch (e) {
                    console.warn(`[CodeTracer] Error parsing step ${idx + 1}:`, e);
                    return { line: 1, vars: [], action: 'Parse error' };
                }
            }).filter(step => step !== null);

            if (steps.length === 0) {
                console.warn('[CodeTracer] No valid steps parsed');
                return `<div class="trace-error"><i class="fas fa-exclamation-triangle"></i> Code Tracer: No valid steps in table</div>`;
            }

        const traceId = 'trace-' + Math.random().toString(36).substr(2, 9);

        // Build code lines with line numbers (reuse codeLines from above)
        const codeLinesHtml = codeLines.map((line, idx) => {
            const lineNum = idx + 1;
            const escapedLine = escapeHtml(line) || '&nbsp;';
            return `<div class="trace-code-line" data-line="${lineNum}"><span class="trace-line-num">${lineNum}</span><span class="trace-line-code">${escapedLine}</span></div>`;
        }).join('');

        // Build state variables display
        const varsHtml = headers.slice(1, -1).map(h =>
            `<div class="trace-var"><span class="trace-var-name">${escapeHtml(h)}</span><span class="trace-var-value" data-var="${escapeHtml(h)}">-</span></div>`
        ).join('');

        // Store steps data as JSON
        const stepsJson = JSON.stringify(steps);

        return `
        <div class="trace-trigger" id="${traceId}-trigger">
            <button class="trace-open-btn" onclick="openTraceModal('${traceId}')">
                <i class="fas fa-play-circle"></i>
                <span>Open Code Tracer: ${escapeHtml(title)}</span>
                <span class="trace-badge">${steps.length} steps</span>
            </button>
        </div>
        <div class="trace-modal-overlay" id="${traceId}-modal" onclick="closeTraceModal('${traceId}', event)" tabindex="-1" role="dialog" aria-modal="true" aria-label="Code Tracer: ${escapeHtml(title)}">
            <div class="trace-modal" onclick="event.stopPropagation()" role="document">
                <div class="trace-modal-header">
                    <div class="trace-modal-title">
                        <i class="fas fa-bug"></i>
                        <span>${escapeHtml(title)}</span>
                        <span class="trace-lang-badge">${escapeHtml(lang)}</span>
                    </div>
                    <button class="trace-close-btn" onclick="closeTraceModal('${traceId}')">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="trace-modal-body">
                    <div class="trace-code-panel">
                        <div class="trace-panel-header">
                            <i class="fas fa-code"></i> Algorithm Code
                        </div>
                        <div class="trace-code-container">
                            ${codeLinesHtml}
                        </div>
                    </div>
                    <div class="trace-state-panel">
                        <div class="trace-panel-header">
                            <i class="fas fa-database"></i> Execution State
                        </div>
                        <div class="trace-state-container">
                            <div class="trace-vars">${varsHtml}</div>
                            <div class="trace-action">
                                <span class="trace-action-label">Current Action:</span>
                                <span class="trace-action-text">Click Next to start</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="trace-modal-footer">
                    <button class="trace-ctrl-btn" onclick="traceStep('${traceId}', -1)" title="Previous Step">
                        <i class="fas fa-step-backward"></i> Prev
                    </button>
                    <div class="trace-progress-info">
                        <span class="trace-step-display">Step <strong>0</strong> of ${steps.length}</span>
                        <div class="trace-progress-bar">
                            <div class="trace-progress-fill" style="width: 0%"></div>
                        </div>
                    </div>
                    <button class="trace-ctrl-btn trace-ctrl-primary" onclick="traceStep('${traceId}', 1)" title="Next Step">
                        Next <i class="fas fa-step-forward"></i>
                    </button>
                    <button class="trace-ctrl-btn" onclick="traceAutoPlay('${traceId}')" title="Auto Play">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="trace-ctrl-btn" onclick="traceReset('${traceId}')" title="Reset">
                        <i class="fas fa-redo"></i>
                    </button>
                </div>
                <div class="trace-keyboard-hint">
                    <span class="trace-shortcut"><kbd>←</kbd><kbd>→</kbd> Navigate</span>
                    <span class="trace-shortcut"><kbd>Space</kbd> Play/Pause</span>
                    <span class="trace-shortcut"><kbd>R</kbd> Reset</span>
                    <span class="trace-shortcut"><kbd>Esc</kbd> Close</span>
                </div>
            </div>
            <script type="application/json" id="${traceId}-data">${stepsJson}</script>
        </div>`;
        } catch (parseError) {
            console.error('[CodeTracer] Fatal parse error:', parseError);
            return `<div class="trace-error"><i class="fas fa-exclamation-triangle"></i> Code Tracer: Parse error - ${escapeHtml(parseError.message || 'Unknown error')}</div>`;
        }
    });

    // Parse :::versus - Side-by-Side Comparison Component
    result = result.replace(/:::versus\{([^}]*)\}\n?([\s\S]*?):::/g, (match, attrs, content) => {
        try {
            // Parse attributes
            const leftMatch = attrs.match(/left="([^"]+)"/);
            const rightMatch = attrs.match(/right="([^"]+)"/);
            const leftLabel = leftMatch ? leftMatch[1] : 'Option A';
            const rightLabel = rightMatch ? rightMatch[1] : 'Option B';

            // Split content into visible and hidden sections
            const hiddenSplit = content.split(/\nHIDDEN:\s*\n?/i);
            const visibleContent = hiddenSplit[0].trim();
            const hiddenContent = hiddenSplit[1] ? hiddenSplit[1].trim() : '';

            // Parse table rows (skip header row and separator)
            const parseRows = (tableContent) => {
                const lines = tableContent.split('\n').filter(line => line.trim().startsWith('|'));
                return lines.slice(1).filter(line => !line.match(/^\|[\s\-:|\+]+\|?$/)).map(line => {
                    const cells = line.split('|').filter(c => c !== '').map(c => c.trim());
                    return { aspect: cells[0] || '', left: cells[1] || '', right: cells[2] || '' };
                });
            };

            const visibleRows = parseRows(visibleContent);
            const hiddenRows = hiddenContent ? parseRows(hiddenContent) : [];

            if (visibleRows.length === 0) {
                return `<div class="versus-error"><i class="fas fa-exclamation-triangle"></i> Versus: No comparison rows found</div>`;
            }

            const versusId = 'versus-' + Math.random().toString(36).substr(2, 9);

            // Build visible rows HTML
            const visibleRowsHtml = visibleRows.map((row, idx) => `
                <div class="versus-row" data-row="${idx}" onmouseenter="versusHighlight('${versusId}', ${idx})" onmouseleave="versusUnhighlight('${versusId}', ${idx})">
                    <div class="versus-aspect">${escapeHtml(row.aspect)}</div>
                    <div class="versus-values">
                        <div class="versus-left">${processInlineMarkdown(row.left)}</div>
                        <div class="versus-right">${processInlineMarkdown(row.right)}</div>
                    </div>
                </div>
            `).join('');

            // Build hidden rows HTML
            const hiddenRowsHtml = hiddenRows.length > 0 ? `
                <div class="versus-hidden" id="${versusId}-hidden">
                    ${hiddenRows.map((row, idx) => `
                        <div class="versus-row versus-hidden-row" data-row="h${idx}">
                            <div class="versus-aspect"><i class="fas fa-lightbulb"></i> ${escapeHtml(row.aspect)}</div>
                            <div class="versus-values">
                                <div class="versus-left">${processInlineMarkdown(row.left)}</div>
                                <div class="versus-right">${processInlineMarkdown(row.right)}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button class="versus-reveal-btn" id="${versusId}-btn" onclick="versusReveal('${versusId}')">
                    <i class="fas fa-eye"></i> Reveal Hidden Insights
                </button>
            ` : '';

            return `
            <div class="versus-container" id="${versusId}">
                <div class="versus-header">
                    <div class="versus-title">
                        <i class="fas fa-balance-scale"></i>
                        <span class="versus-left-label">${escapeHtml(leftLabel)}</span>
                        <span class="versus-vs">vs</span>
                        <span class="versus-right-label">${escapeHtml(rightLabel)}</span>
                    </div>
                </div>
                <div class="versus-body">
                    <div class="versus-labels">
                        <div class="versus-label-spacer"></div>
                        <div class="versus-label-left">${escapeHtml(leftLabel)}</div>
                        <div class="versus-label-right">${escapeHtml(rightLabel)}</div>
                    </div>
                    ${visibleRowsHtml}
                    ${hiddenRowsHtml}
                </div>
            </div>`;
        } catch (e) {
            console.error('[Versus] Parse error:', e);
            return `<div class="versus-error"><i class="fas fa-exclamation-triangle"></i> Versus: Parse error</div>`;
        }
    });

    return result;
}

// Copy code from slide component
function copySlideCode(button) {
    const codeBlock = button.closest('.slide-component.code');
    const code = codeBlock.querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(() => {
        button.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => {
            button.innerHTML = '<i class="fas fa-copy"></i> Copy';
        }, 2000);
    });
}

// Flashcard flip function
function flipFlashcard(cardId) {
    const container = document.getElementById(cardId);
    if (!container) return;
    const card = container.querySelector('.flashcard');
    card.classList.toggle('flipped');

    const instruction = container.querySelector('.flashcard-instruction');
    instruction.textContent = card.classList.contains('flipped') ? 'Click to flip back' : 'Click to flip';
}

// Versus Component Functions
function versusHighlight(versusId, rowIndex) {
    const container = document.getElementById(versusId);
    if (!container) return;
    const rows = container.querySelectorAll(`.versus-row[data-row="${rowIndex}"]`);
    rows.forEach(row => row.classList.add('highlighted'));
}

function versusUnhighlight(versusId, rowIndex) {
    const container = document.getElementById(versusId);
    if (!container) return;
    const rows = container.querySelectorAll(`.versus-row[data-row="${rowIndex}"]`);
    rows.forEach(row => row.classList.remove('highlighted'));
}

function versusReveal(versusId) {
    const hidden = document.getElementById(`${versusId}-hidden`);
    const btn = document.getElementById(`${versusId}-btn`);
    if (!hidden || !btn) return;

    if (hidden.classList.contains('revealed')) {
        hidden.classList.remove('revealed');
        btn.innerHTML = '<i class="fas fa-eye"></i> Reveal Hidden Insights';
    } else {
        hidden.classList.add('revealed');
        btn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Insights';
    }
}

// Code Tracer Modal Functions - BULLETPROOF VERSION

// CSS.escape polyfill for older browsers
if (!window.CSS || !CSS.escape) {
    window.CSS = window.CSS || {};
    CSS.escape = function(value) {
        if (arguments.length === 0) throw new TypeError('CSS.escape requires an argument.');
        var string = String(value);
        var length = string.length;
        var result = '';
        for (var i = 0; i < length; i++) {
            var char = string.charAt(i);
            var code = string.charCodeAt(i);
            if (code === 0) { result += '\uFFFD'; continue; }
            if ((code >= 0x0001 && code <= 0x001F) || code === 0x007F ||
                (i === 0 && code >= 0x0030 && code <= 0x0039) ||
                (i === 1 && code >= 0x0030 && code <= 0x0039 && string.charCodeAt(0) === 0x002D)) {
                result += '\\' + code.toString(16) + ' ';
                continue;
            }
            if (i === 0 && code === 0x002D && length === 1) {
                result += '\\' + char;
                continue;
            }
            if (code >= 0x0080 || code === 0x002D || code === 0x005F ||
                (code >= 0x0030 && code <= 0x0039) ||
                (code >= 0x0041 && code <= 0x005A) ||
                (code >= 0x0061 && code <= 0x007A)) {
                result += char;
                continue;
            }
            result += '\\' + char;
        }
        return result;
    };
}

const traceStates = {};
let activeTraceModal = null; // Track active modal for keyboard events

// Global keyboard handler for trace modals
document.addEventListener('keydown', function(e) {
    if (!activeTraceModal) return;

    // Don't intercept keyboard when user is typing in an input/textarea
    if (isUserTypingInInput()) return;

    const traceId = activeTraceModal;

    switch(e.key) {
        case 'Escape':
            e.preventDefault();
            closeTraceModal(traceId);
            break;
        case 'ArrowRight':
        case 'ArrowDown':
            e.preventDefault();
            traceStep(traceId, 1);
            break;
        case 'ArrowLeft':
        case 'ArrowUp':
            e.preventDefault();
            traceStep(traceId, -1);
            break;
        case ' ': // Spacebar for play/pause
            e.preventDefault();
            traceAutoPlay(traceId);
            break;
        case 'r':
        case 'R':
            if (!e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                traceReset(traceId);
            }
            break;
        case 'Home':
            e.preventDefault();
            traceGoTo(traceId, 0);
            break;
        case 'End':
            e.preventDefault();
            const state = traceStates[traceId];
            if (state && state.steps.length > 0) {
                traceGoTo(traceId, state.steps.length - 1);
            }
            break;
    }
});

function openTraceModal(traceId) {
    const modal = document.getElementById(`${traceId}-modal`);
    if (!modal) {
        console.error(`[CodeTracer] Modal not found: ${traceId}`);
        return;
    }

    // Initialize state if not exists
    if (!traceStates[traceId]) {
        const dataEl = document.getElementById(`${traceId}-data`);
        if (!dataEl) {
            console.error(`[CodeTracer] Data element not found: ${traceId}-data`);
            return;
        }

        let steps = [];
        try {
            steps = JSON.parse(dataEl.textContent);
            if (!Array.isArray(steps)) {
                console.error('[CodeTracer] Steps data is not an array');
                steps = [];
            }
        } catch (e) {
            console.error('[CodeTracer] Failed to parse steps JSON:', e);
            steps = [];
        }

        traceStates[traceId] = {
            currentStep: -1,
            steps: steps,
            autoPlayInterval: null,
            autoPlaySpeed: 1500
        };
    }

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    activeTraceModal = traceId;

    // Reset to beginning
    traceReset(traceId);

    // Focus modal for keyboard navigation
    modal.focus();
}

function closeTraceModal(traceId, event) {
    // Defensive: only close on overlay click, not modal content
    if (event && event.target !== event.currentTarget) return;

    const modal = document.getElementById(`${traceId}-modal`);
    if (!modal) {
        console.warn(`[CodeTracer] Cannot close - modal not found: ${traceId}`);
        return;
    }

    modal.classList.remove('active');
    document.body.style.overflow = '';
    activeTraceModal = null; // Clear keyboard focus

    // Stop autoplay if running
    if (traceStates[traceId]?.autoPlayInterval) {
        clearInterval(traceStates[traceId].autoPlayInterval);
        traceStates[traceId].autoPlayInterval = null;
    }
}

function traceStep(traceId, direction) {
    const state = traceStates[traceId];
    if (!state) {
        console.warn(`[CodeTracer] No state for: ${traceId}`);
        return;
    }

    if (!state.steps || state.steps.length === 0) {
        console.warn(`[CodeTracer] No steps available for: ${traceId}`);
        return;
    }

    const newStep = state.currentStep + direction;

    // Clamp to valid range
    if (newStep < 0 || newStep >= state.steps.length) {
        return; // Silent - reached boundary
    }

    traceGoTo(traceId, newStep);
}

function traceGoTo(traceId, stepIndex) {
    const state = traceStates[traceId];
    const modal = document.getElementById(`${traceId}-modal`);

    if (!state) {
        console.error(`[CodeTracer] traceGoTo - No state for: ${traceId}`);
        return;
    }
    if (!modal) {
        console.error(`[CodeTracer] traceGoTo - Modal not found: ${traceId}`);
        return;
    }
    if (!state.steps || state.steps.length === 0) {
        console.error(`[CodeTracer] traceGoTo - No steps available`);
        return;
    }

    // Validate stepIndex
    const validIndex = Math.max(0, Math.min(stepIndex, state.steps.length - 1));
    state.currentStep = validIndex;

    const step = state.steps[validIndex];
    if (!step) {
        console.error(`[CodeTracer] traceGoTo - Invalid step at index ${validIndex}`);
        return;
    }

    // Update code line highlighting
    const codeLines = modal.querySelectorAll('.trace-code-line');
    codeLines.forEach(line => {
        const lineNum = parseInt(line.dataset.line) || 0;
        line.classList.remove('active', 'past');
        if (lineNum === step.line) {
            line.classList.add('active');
            // Smooth scroll to active line
            try {
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch (e) {
                // Fallback for older browsers
                line.scrollIntoView(true);
            }
        } else if (lineNum < step.line) {
            line.classList.add('past');
        }
    });

    // Update variable values with animation
    if (step.vars && Array.isArray(step.vars)) {
        step.vars.forEach(v => {
            if (!v || !v.name) return;
            const varEl = modal.querySelector(`.trace-var-value[data-var="${CSS.escape(v.name)}"]`);
            if (varEl) {
                varEl.textContent = v.value || '-';
                varEl.classList.add('updated');
                setTimeout(() => varEl.classList.remove('updated'), 300);
            }
        });
    }

    // Update action text
    const actionText = modal.querySelector('.trace-action-text');
    if (actionText) {
        actionText.textContent = step.action || 'No description';
    }

    // Update progress display
    const stepDisplay = modal.querySelector('.trace-step-display strong');
    if (stepDisplay) {
        stepDisplay.textContent = validIndex + 1;
    }

    const progressFill = modal.querySelector('.trace-progress-fill');
    if (progressFill && state.steps.length > 0) {
        const percent = ((validIndex + 1) / state.steps.length) * 100;
        progressFill.style.width = `${percent}%`;
    }
}

function traceReset(traceId) {
    const state = traceStates[traceId];
    const modal = document.getElementById(`${traceId}-modal`);

    if (!state) {
        console.warn(`[CodeTracer] traceReset - No state for: ${traceId}`);
        return;
    }
    if (!modal) {
        console.warn(`[CodeTracer] traceReset - Modal not found: ${traceId}`);
        return;
    }

    // Stop autoplay
    if (state.autoPlayInterval) {
        clearInterval(state.autoPlayInterval);
        state.autoPlayInterval = null;
        const playBtn = modal.querySelector('.trace-ctrl-btn .fa-pause');
        if (playBtn) playBtn.className = 'fas fa-play';
    }

    state.currentStep = -1;

    // Reset code highlighting
    modal.querySelectorAll('.trace-code-line').forEach(line => {
        line.classList.remove('active', 'past');
    });

    // Reset variables
    modal.querySelectorAll('.trace-var-value').forEach(v => {
        v.textContent = '-';
    });

    // Reset action
    const actionText = modal.querySelector('.trace-action-text');
    if (actionText) actionText.textContent = 'Press Next or use Arrow keys to start';

    // Reset progress
    const stepDisplay = modal.querySelector('.trace-step-display strong');
    if (stepDisplay) stepDisplay.textContent = '0';

    const progressFill = modal.querySelector('.trace-progress-fill');
    if (progressFill) progressFill.style.width = '0%';
}

function traceAutoPlay(traceId) {
    const state = traceStates[traceId];
    const modal = document.getElementById(`${traceId}-modal`);

    if (!state) {
        console.error(`[CodeTracer] traceAutoPlay - No state for: ${traceId}`);
        return;
    }
    if (!modal) {
        console.error(`[CodeTracer] traceAutoPlay - Modal not found: ${traceId}`);
        return;
    }
    if (!state.steps || state.steps.length === 0) {
        console.warn(`[CodeTracer] traceAutoPlay - No steps to play`);
        return;
    }

    const playBtn = modal.querySelector('.trace-ctrl-btn .fa-play, .trace-ctrl-btn .fa-pause');

    if (state.autoPlayInterval) {
        // Stop autoplay
        clearInterval(state.autoPlayInterval);
        state.autoPlayInterval = null;
        if (playBtn) playBtn.className = 'fas fa-play';
    } else {
        // Start autoplay
        if (playBtn) playBtn.className = 'fas fa-pause';

        // If at end, reset first
        if (state.currentStep >= state.steps.length - 1) {
            traceReset(traceId);
        }

        const speed = state.autoPlaySpeed || 1500;
        state.autoPlayInterval = setInterval(() => {
            if (state.currentStep >= state.steps.length - 1) {
                clearInterval(state.autoPlayInterval);
                state.autoPlayInterval = null;
                if (playBtn) playBtn.className = 'fas fa-play';
                return;
            }
            traceStep(traceId, 1);
        }, speed);
    }
}

// Select quiz option
async function selectQuizOption(element) {
    const quiz = element.closest('.slide-component.quiz');

    // Prevent re-answering
    if (quiz.dataset.answered === 'true') return;
    quiz.dataset.answered = 'true';

    const selectedAnswer = element.dataset.option;
    const correctAnswer = quiz.dataset.correctAnswer || 'A'; // Default to A if not set
    const isCorrect = selectedAnswer === correctAnswer;
    const explanation = quiz.dataset.explanation || '';

    // Visual feedback for all options
    quiz.querySelectorAll('.quiz-option').forEach(opt => {
        opt.classList.remove('selected');
        opt.style.pointerEvents = 'none'; // Disable further clicks

        if (opt.dataset.option === correctAnswer) {
            opt.classList.add('correct');
            opt.style.background = 'rgba(16, 185, 129, 0.3)';
            opt.style.borderColor = 'rgba(16, 185, 129, 0.8)';
        }
    });

    // Mark selected as correct or incorrect
    if (isCorrect) {
        element.classList.add('selected', 'correct');
    } else {
        element.classList.add('selected', 'incorrect');
        element.style.background = 'rgba(239, 68, 68, 0.3)';
        element.style.borderColor = 'rgba(239, 68, 68, 0.8)';
    }

    // Show feedback
    const feedbackDiv = document.createElement('div');
    feedbackDiv.className = 'quiz-feedback';
    feedbackDiv.innerHTML = `
        <div class="quiz-feedback-header ${isCorrect ? 'correct' : 'incorrect'}">
            <i class="fas ${isCorrect ? 'fa-check-circle' : 'fa-times-circle'}"></i>
            ${isCorrect ? 'Correct!' : 'Incorrect - The correct answer is ' + correctAnswer}
        </div>
        ${explanation ? `<div class="quiz-explanation">${explanation}</div>` : ''}
    `;
    quiz.appendChild(feedbackDiv);

    // Track quiz attempt (if endpoint exists)
    try {
        await fetch('/api/quiz/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                documentPath: currentLeftPDF?.path || window.location.pathname,
                questionText: quiz.querySelector('.quiz-question')?.textContent || '',
                answerGiven: selectedAnswer,
                isCorrect: isCorrect
            })
        });
    } catch (e) {
        // Quiz tracking not available yet - that's ok
    }
}

// ============================================================================
// STEP VISUALIZER - Immersive Animated Process Component (using anime.js)
// ============================================================================

const stepVizStates = {};

function getStepVizState(vizId) {
    if (!stepVizStates[vizId]) {
        const viz = document.getElementById(vizId);
        stepVizStates[vizId] = {
            currentStep: 0,
            totalSteps: parseInt(viz?.dataset.total) || 1,
            speed: parseInt(viz?.dataset.speed) || 2500,
            isPlaying: false,
            intervalId: null,
            isAnimating: false,
            mode: 'focus' // 'focus' or 'overview'
        };
    }
    return stepVizStates[vizId];
}

// Toggle between focus and overview mode
function stepVizToggleMode(vizId) {
    const state = getStepVizState(vizId);
    const newMode = state.mode === 'focus' ? 'overview' : 'focus';
    stepVizSetMode(vizId, newMode);
}

// Set specific mode
function stepVizSetMode(vizId, mode) {
    const state = getStepVizState(vizId);
    const viz = document.getElementById(vizId);
    if (!viz) return;

    state.mode = mode;
    viz.dataset.mode = mode;

    // Update toggle button icon
    const toggleBtn = viz.querySelector('.stepviz-mode-toggle i');
    if (toggleBtn) {
        toggleBtn.className = mode === 'focus' ? 'fas fa-th-list' : 'fas fa-expand';
    }

    // Stop playback when switching to overview
    if (mode === 'overview' && state.isPlaying) {
        clearInterval(state.intervalId);
        state.isPlaying = false;
        stepVizUpdateUI(vizId);
    }
}

// Update overview items to highlight current step
function stepVizUpdateOverview(vizId, currentStep) {
    const viz = document.getElementById(vizId);
    if (!viz) return;

    const overviewItems = viz.querySelectorAll('.stepviz-overview-item');
    overviewItems.forEach((item, i) => {
        item.classList.remove('active', 'completed');
        if (i < currentStep) {
            item.classList.add('completed');
        } else if (i === currentStep) {
            item.classList.add('active');
        }
    });
}

// Animate transition between steps using anime.js
function stepVizAnimateTransition(vizId, fromStep, toStep, direction) {
    const viz = document.getElementById(vizId);
    if (!viz) return Promise.resolve();

    const state = getStepVizState(vizId);
    if (state.isAnimating) return Promise.resolve();
    state.isAnimating = true;

    const container = viz.querySelector('.stepviz-cards-container');
    const cards = viz.querySelectorAll('.stepviz-card');
    const dots = viz.querySelectorAll('.stepviz-dot');
    const progressFill = viz.querySelector('.stepviz-im-progress-fill');

    const fromCard = cards[fromStep];
    const toCard = cards[toStep];

    if (!fromCard || !toCard) {
        state.isAnimating = false;
        return Promise.resolve();
    }

    // Lock container height to prevent layout shift
    if (container) {
        const currentHeight = container.offsetHeight;
        container.style.minHeight = `${currentHeight}px`;
    }

    // Update dots
    dots.forEach((dot, i) => {
        dot.classList.remove('active', 'current');
        if (i < toStep) dot.classList.add('active');
        if (i === toStep) dot.classList.add('active', 'current');
    });

    // Update overview
    stepVizUpdateOverview(vizId, toStep);

    // Update progress bar with anime.js
    if (progressFill && typeof anime !== 'undefined') {
        anime({
            targets: progressFill,
            width: `${((toStep + 1) / state.totalSteps) * 100}%`,
            duration: 400,
            easing: 'easeOutQuart'
        });
    }

    // Card transition animation
    return new Promise(resolve => {
        if (typeof anime === 'undefined') {
            // Fallback without anime.js
            fromCard.classList.remove('active');
            fromCard.style.opacity = '0';
            toCard.classList.add('active');
            toCard.style.opacity = '1';
            state.isAnimating = false;
            resolve();
            return;
        }

        // First, prepare toCard (position it off-screen)
        toCard.style.position = 'absolute';
        toCard.style.top = '0';
        toCard.style.left = '0';
        toCard.style.right = '0';
        toCard.style.opacity = '0';
        toCard.style.transform = `translateX(${direction > 0 ? 60 : -60}px) scale(0.95)`;

        const timeline = anime.timeline({
            easing: 'easeOutCubic',
            complete: () => {
                // Clean up styles
                fromCard.style.position = 'absolute';
                toCard.style.position = 'relative';
                toCard.style.transform = '';
                state.isAnimating = false;
                resolve();
            }
        });

        // Animate out current card
        timeline.add({
            targets: fromCard,
            opacity: [1, 0],
            translateX: [0, direction > 0 ? -60 : 60],
            scale: [1, 0.95],
            duration: 250,
            easing: 'easeInCubic',
            complete: () => {
                fromCard.classList.remove('active');
            }
        });

        // Animate in new card
        timeline.add({
            targets: toCard,
            opacity: [0, 1],
            translateX: [direction > 0 ? 60 : -60, 0],
            scale: [0.95, 1],
            duration: 350,
            begin: () => {
                toCard.classList.add('active');
            }
        }, '-=50');
    });
}

function stepVizUpdateUI(vizId) {
    const state = getStepVizState(vizId);
    const viz = document.getElementById(vizId);
    if (!viz) return;

    // Update play button icon
    const playBtn = viz.querySelector('.stepviz-im-play i');
    if (playBtn) {
        playBtn.className = state.isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }

    // Store current step on element for keyboard handler
    viz.dataset.current = state.currentStep;
}

async function stepVizNext(vizId) {
    const state = getStepVizState(vizId);
    if (state.isAnimating) return;

    if (state.currentStep < state.totalSteps - 1) {
        const fromStep = state.currentStep;
        state.currentStep++;
        await stepVizAnimateTransition(vizId, fromStep, state.currentStep, 1);
        stepVizUpdateUI(vizId);
    } else if (state.isPlaying) {
        stepVizTogglePlay(vizId); // Stop at end
    }
}

async function stepVizPrev(vizId) {
    const state = getStepVizState(vizId);
    if (state.isAnimating) return;

    if (state.currentStep > 0) {
        const fromStep = state.currentStep;
        state.currentStep--;
        await stepVizAnimateTransition(vizId, fromStep, state.currentStep, -1);
        stepVizUpdateUI(vizId);
    }
}

async function stepVizGoTo(vizId, targetStep) {
    const state = getStepVizState(vizId);
    if (state.isAnimating || targetStep === state.currentStep) return;

    const fromStep = state.currentStep;
    const direction = targetStep > fromStep ? 1 : -1;
    state.currentStep = targetStep;
    await stepVizAnimateTransition(vizId, fromStep, targetStep, direction);
    stepVizUpdateUI(vizId);
}

function stepVizReset(vizId) {
    const state = getStepVizState(vizId);
    if (state.isPlaying) {
        clearInterval(state.intervalId);
        state.isPlaying = false;
    }
    stepVizGoTo(vizId, 0);
}

function stepVizTogglePlay(vizId) {
    const state = getStepVizState(vizId);
    const viz = document.getElementById(vizId);

    // Switch to focus mode if in overview
    if (state.mode === 'overview') {
        stepVizSetMode(vizId, 'focus');
    }

    if (state.isPlaying) {
        clearInterval(state.intervalId);
        state.isPlaying = false;
    } else {
        // Reset to start if at end
        if (state.currentStep >= state.totalSteps - 1) {
            state.currentStep = -1;
            const cards = viz?.querySelectorAll('.stepviz-card');
            const dots = viz?.querySelectorAll('.stepviz-dot');
            cards?.forEach(c => {
                c.classList.remove('active');
                c.style.opacity = '0';
            });
            dots?.forEach(d => d.classList.remove('active', 'current'));
        }
        state.isPlaying = true;
        // Initial step
        stepVizNext(vizId);
        // Continue with interval
        state.intervalId = setInterval(() => {
            stepVizNext(vizId);
        }, state.speed);
    }
    stepVizUpdateUI(vizId);
}

// Initialize step visualizers
function initStepVisualizers() {
    document.querySelectorAll('.slide-component.stepviz-immersive').forEach(viz => {
        if (!viz.dataset.initialized) {
            viz.dataset.initialized = 'true';

            // Set initial state for cards
            const cards = viz.querySelectorAll('.stepviz-card');
            const container = viz.querySelector('.stepviz-cards-container');

            cards.forEach((card, i) => {
                if (i === 0) {
                    card.classList.add('active');
                    card.style.opacity = '1';
                    card.style.position = 'relative';
                } else {
                    card.classList.remove('active');
                    card.style.opacity = '0';
                    card.style.position = 'absolute';
                    card.style.top = '0';
                    card.style.left = '0';
                    card.style.right = '0';
                }
            });

            // Set initial state for overview
            const overviewItems = viz.querySelectorAll('.stepviz-overview-item');
            overviewItems.forEach((item, i) => {
                if (i === 0) item.classList.add('active');
            });

            // Autoplay if enabled
            if (viz.dataset.autoplay === 'true') {
                setTimeout(() => stepVizTogglePlay(viz.id), 800);
            }
        }
    });
}

// Clean up step visualizer states when exiting slides
function cleanupStepVisualizers() {
    for (const vizId in stepVizStates) {
        if (stepVizStates[vizId].intervalId) {
            clearInterval(stepVizStates[vizId].intervalId);
        }
    }
    Object.keys(stepVizStates).forEach(key => delete stepVizStates[key]);
}

// Render Claude's response with markdown and KaTeX
function renderStudyContent(text) {
    if (!text) return '';

    // First, extract and protect slide components from markdown processing
    const componentBlocks = [];
    // Match component blocks: :::type{attrs}\n content \n:::
    // Use a more robust regex that handles quoted strings in attributes
    let processedText = text.replace(/:::\w+\{[^}]*\}[\s\S]*?^:::\s*$/gm, (match) => {
        componentBlocks.push(parseSlideComponents(match));
        return `%%COMPONENT_${componentBlocks.length - 1}%%`;
    });
    // Also match simpler component blocks without attributes
    processedText = processedText.replace(/:::\w+\n[\s\S]*?^:::\s*$/gm, (match) => {
        componentBlocks.push(parseSlideComponents(match));
        return `%%COMPONENT_${componentBlocks.length - 1}%%`;
    });

    // Pre-process: protect LaTeX from markdown processing
    const displayMathBlocks = [];
    processedText = processedText.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
        displayMathBlocks.push(math);
        return `%%DISPLAY_MATH_${displayMathBlocks.length - 1}%%`;
    });

    const inlineMathBlocks = [];
    processedText = processedText.replace(/\$([^\$\n]+?)\$/g, (match, math) => {
        inlineMathBlocks.push(math);
        return `%%INLINE_MATH_${inlineMathBlocks.length - 1}%%`;
    });

    // Use marked.js if available
    let html = processedText;

    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,
            gfm: true,
            highlight: function(code, lang) {
                if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(code, { language: lang }).value;
                    } catch (e) {}
                }
                return code;
            }
        });
        html = marked.parse(processedText);
    } else {
        // Fallback: basic markdown
        html = escapeHtml(processedText);
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
        html = html.replace(/`(.+?)`/g, '<code>$1</code>');
        html = html.replace(/\n/g, '<br>');
    }

    // Restore and render KaTeX - display math
    if (typeof katex !== 'undefined') {
        html = html.replace(/%%DISPLAY_MATH_(\d+)%%/g, (match, index) => {
            const math = displayMathBlocks[parseInt(index)];
            try {
                return '<div class="katex-display">' + katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) + '</div>';
            } catch (e) {
                return '$$' + math + '$$';
            }
        });

        html = html.replace(/%%INLINE_MATH_(\d+)%%/g, (match, index) => {
            const math = inlineMathBlocks[parseInt(index)];
            try {
                return katex.renderToString(math.trim(), { throwOnError: false });
            } catch (e) {
                return '$' + math + '$';
            }
        });
    } else {
        // Just restore without rendering
        html = html.replace(/%%DISPLAY_MATH_(\d+)%%/g, (match, index) => '$$' + displayMathBlocks[parseInt(index)] + '$$');
        html = html.replace(/%%INLINE_MATH_(\d+)%%/g, (match, index) => '$' + inlineMathBlocks[parseInt(index)] + '$');
    }

    // Restore slide components (quiz, definition, example, etc.)
    html = html.replace(/%%COMPONENT_(\d+)%%/g, (match, index) => {
        return componentBlocks[parseInt(index)] || '';
    });

    return html;
}

// Create empty state element
function createEmptyState() {
    const div = document.createElement('div');
    div.id = 'study-empty-state';
    div.className = 'study-empty-state';
    div.innerHTML = `
        <i class="fas fa-graduation-cap"></i>
        <h3>Start Learning</h3>
        <p>Ask questions about your document. Claude will help you understand concepts, explain formulas, and create interactive study materials.</p>
    `;
    return div;
}

// Send a study message
async function sendStudyMessage() {
    const input = document.getElementById('study-input');
    const sendBtn = document.getElementById('study-send-btn');

    if (!input || studyIsLoading) return;

    const question = input.value.trim();
    if (!question) return;

    // Check if we have any context (primary doc or references)
    if (!studyCurrentDocument && studyReferencedFiles.length === 0) {
        showNotification('Please add a document or reference to study', 3000);
        return;
    }

    // Clear input
    input.value = '';
    input.style.height = 'auto';
    hideStudyFileAutocomplete();

    // Capture images before clearing
    const imagesToSend = [...studyPastedImages];
    studyPastedImages = [];
    renderStudyImagePreviews();

    // Add user message (with image indicator if any)
    const userContent = imagesToSend.length > 0
        ? `${question}\n\n[${imagesToSend.length} image(s) attached]`
        : question;
    studyMessages.push({ role: 'user', content: userContent, images: imagesToSend });
    renderStudyMessages();

    // Show loading
    studyIsLoading = true;
    if (sendBtn) sendBtn.disabled = true;

    // Add loading message
    const loadingId = addStudyLoadingMessage();

    // Prepare referenced files - separate YouTube and regular files
    const regularFiles = studyReferencedFiles.filter(f => f.type !== 'youtube');
    const youtubeRefs = studyReferencedFiles.filter(f => f.type === 'youtube');

    const referencedFilePaths = regularFiles.map(f => f.path);
    const youtubeTranscripts = youtubeRefs.map(f => ({
        videoId: f.videoId,
        language: f.language,
        transcript: f.transcript
    }));

    // Prepare images as base64 array (just the data part, not the full data URL)
    const imageData = imagesToSend.map(img => ({
        data: img.data.split(',')[1], // Remove "data:image/png;base64," prefix
        type: img.type
    }));

    // Determine primary document path (use extracted if pages selected)
    // If no primary doc, use first referenced file as the document path
    let primaryDocPath = studyPrimaryDocExtractedPath || studyCurrentDocument;
    if (!primaryDocPath && regularFiles.length > 0) {
        primaryDocPath = regularFiles[0].path;
    }

    try {
        const response = await fetch('/api/study-claude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: question,
                documentPath: primaryDocPath,
                referencedFiles: referencedFilePaths,
                youtubeTranscripts: youtubeTranscripts,
                slideMode: true, // Always request slide-formatted content
                images: imageData
            })
        });

        // Remove loading message
        removeStudyLoadingMessage(loadingId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            // Always render in chat mode - user can click "View Slides" if they want
            studyMessages.push({ role: 'assistant', content: data.answer });
            renderStudyMessages();

            // Save to history
            saveStudyChatHistory(question, data.answer);
        } else {
            studyMessages.push({ role: 'error', content: data.error || 'Failed to get response' });
            renderStudyMessages();
        }
    } catch (error) {
        removeStudyLoadingMessage(loadingId);
        studyMessages.push({ role: 'error', content: 'Error: ' + error.message });
        renderStudyMessages();
    } finally {
        studyIsLoading = false;
        if (sendBtn) sendBtn.disabled = false;
    }
}

// Add loading message
function addStudyLoadingMessage() {
    const container = document.getElementById('study-messages');
    if (!container) return null;

    const id = 'study-loading-' + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = id;
    loadingDiv.className = 'study-message assistant loading';
    loadingDiv.innerHTML = `
        <div class="study-message-header">
            <i class="fas fa-magic"></i>
            <span>Claude</span>
        </div>
        <div class="study-message-content">
            <div class="study-loading-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <span style="margin-left: 8px; color: #8e8e93;">Thinking...</span>
        </div>
    `;
    container.appendChild(loadingDiv);
    container.scrollTop = container.scrollHeight;
    return id;
}

// Remove loading message
function removeStudyLoadingMessage(id) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.remove();
}

// Save chat history
async function saveStudyChatHistory(question, answer) {
    try {
        await fetch('/api/chat-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                documentPath: studyCurrentDocument,
                question: question,
                answer: answer
            })
        });
    } catch (error) {
        console.error('Error saving chat history:', error);
    }
}

// ============================================================================
// SLIDE PRESENTATION MODE
// ============================================================================

let currentSlideIndex = 0;
let slidesData = [];

// Auto-split content into slides based on headers
function autoSplitIntoSlides(content) {
    // Split by ## headers (h2)
    const sections = content.split(/(?=^## )/m);

    if (sections.length <= 1) {
        // No h2 headers, try splitting by ### (h3)
        const h3Sections = content.split(/(?=^### )/m);
        if (h3Sections.length > 1) {
            return h3Sections.map(s => s.trim()).filter(s => s).join('\n---SLIDE---\n');
        }
        // No headers at all, split by double newlines into chunks
        const paragraphs = content.split(/\n\n+/);
        const chunks = [];
        let currentChunk = '';
        for (const para of paragraphs) {
            if ((currentChunk + para).length > 1500 && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = para;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + para;
            }
        }
        if (currentChunk.trim()) chunks.push(currentChunk.trim());
        return chunks.join('\n---SLIDE---\n');
    }

    return sections.map(s => s.trim()).filter(s => s).join('\n---SLIDE---\n');
}

// Render slides presentation
function renderStudySlides(content, question) {
    // Parse slides
    const slideContents = content.split('---SLIDE---').map(s => s.trim()).filter(s => s);

    if (slideContents.length === 0) {
        // Fallback to chat
        studyMessages.push({ role: 'assistant', content: content });
        renderStudyMessages();
        return;
    }

    slidesData = slideContents.map((slideContent, index) => {
        // Extract title from first header or first line
        let title = `Slide ${index + 1}`;
        let body = slideContent;

        const headerMatch = slideContent.match(/^#+ (.+)$/m);
        if (headerMatch) {
            title = headerMatch[1];
            body = slideContent.replace(/^#+ .+\n?/, '').trim();
        } else {
            const firstLine = slideContent.split('\n')[0];
            if (firstLine.length < 100 && !firstLine.startsWith('-') && !firstLine.startsWith('*')) {
                title = firstLine.replace(/^\*\*|\*\*$/g, '');
                body = slideContent.split('\n').slice(1).join('\n').trim();
            }
        }

        return { title, body };
    });

    currentSlideIndex = 0;

    // Switch to slide view
    const chatPanel = document.getElementById('study-panel-chat');
    const historyPanel = document.getElementById('study-panel-history');
    const slideView = document.getElementById('study-slide-view');
    const inputArea = document.querySelector('.study-input-area');

    if (chatPanel) chatPanel.style.display = 'none';
    if (historyPanel) historyPanel.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';

    if (slideView) {
        slideView.classList.add('active');
        slideView.innerHTML = `
            <div class="slide-top-controls">
                <button class="slide-fullscreen-btn" onclick="toggleSlideFullscreen()" title="Toggle Fullscreen (F)">
                    <i class="fas fa-expand"></i>
                </button>
                <button class="slide-exit-btn" onclick="exitSlideView()">
                    <i class="fas fa-times"></i> Exit Slides
                </button>
            </div>
            <div class="slide-container" id="slide-container">
                ${slidesData.map((slide, i) => `
                    <div class="slide ${i === 0 ? 'active' : 'next'}" data-index="${i}">
                        <div class="slide-title">${escapeHtml(slide.title)}</div>
                        <div class="slide-content">${renderStudyContent(slide.body)}</div>
                    </div>
                `).join('')}
            </div>
            <div class="slide-navigation">
                <button class="slide-nav-btn" id="slide-prev-btn" onclick="prevSlide()" ${currentSlideIndex === 0 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-left"></i>
                </button>
                <div class="slide-indicators" id="slide-indicators">
                    ${slidesData.map((_, i) => `
                        <div class="slide-indicator ${i === 0 ? 'active' : ''}" data-index="${i}" onclick="goToSlide(${i})"></div>
                    `).join('')}
                </div>
                <span class="slide-counter" id="slide-counter">1 / ${slidesData.length}</span>
                <button class="slide-nav-btn" id="slide-next-btn" onclick="nextSlide()" ${slidesData.length <= 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;

        // Add keyboard navigation
        document.addEventListener('keydown', handleSlideKeydown);

        // Render Mermaid diagrams
        renderMermaidDiagrams();

        // Initialize step visualizers (autoplay)
        initStepVisualizers();
    }
}

// Render Mermaid.js diagrams in the current view
async function renderMermaidDiagrams() {
    if (typeof mermaid === 'undefined') return;

    const diagrams = document.querySelectorAll('.mermaid-diagram:not([data-rendered="true"])');
    for (const diagram of diagrams) {
        // Try base64 encoded first, then fall back to plain text
        let code = '';
        if (diagram.dataset.mermaidEncoded) {
            try {
                code = decodeURIComponent(escape(atob(diagram.dataset.mermaidEncoded)));
            } catch (e) {
                console.error('Failed to decode mermaid:', e);
            }
        }
        if (!code && diagram.dataset.mermaid) {
            code = diagram.dataset.mermaid;
        }
        if (!code) continue;

        // Decode HTML entities (fixes &quot; &gt; &lt; etc.)
        const textarea = document.createElement('textarea');
        textarea.innerHTML = code;
        code = textarea.value;

        try {
            const id = diagram.id || 'mermaid-' + Math.random().toString(36).substr(2, 9);
            const { svg } = await mermaid.render(id + '-svg', code);
            diagram.innerHTML = svg;
            diagram.dataset.rendered = 'true';
            diagram.classList.add('rendered');

            // Fix text colors based on background luminance
            fixMermaidTextColors(diagram);
        } catch (error) {
            console.error('Mermaid render error:', error);
            diagram.innerHTML = `<div class="mermaid-error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Diagram rendering failed</span>
                <pre>${escapeHtml(code)}</pre>
            </div>`;
        }
    }
}

// Fix Mermaid text colors based on node background luminance
function fixMermaidTextColors(container) {
    const nodes = container.querySelectorAll('.node');
    nodes.forEach(node => {
        const rect = node.querySelector('rect, polygon, circle, ellipse');
        const label = node.querySelector('.nodeLabel, foreignObject div');
        if (!rect || !label) return;

        // Get fill color from style or attribute
        let fillColor = rect.style.fill || rect.getAttribute('fill') || '';

        // Parse the color
        let r = 55, g = 65, b = 81; // Default dark gray
        if (fillColor.startsWith('rgb')) {
            const match = fillColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (match) {
                r = parseInt(match[1]);
                g = parseInt(match[2]);
                b = parseInt(match[3]);
            }
        } else if (fillColor.startsWith('#')) {
            const hex = fillColor.replace('#', '');
            if (hex.length === 3) {
                r = parseInt(hex[0] + hex[0], 16);
                g = parseInt(hex[1] + hex[1], 16);
                b = parseInt(hex[2] + hex[2], 16);
            } else if (hex.length === 6) {
                r = parseInt(hex.substr(0, 2), 16);
                g = parseInt(hex.substr(2, 2), 16);
                b = parseInt(hex.substr(4, 2), 16);
            }
        }

        // Calculate luminance (perceived brightness)
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

        // Set text color based on background luminance
        const textColor = luminance > 0.5 ? '#1a1a2e' : '#ffffff';

        // Apply to label
        if (label.tagName === 'foreignObject') {
            const div = label.querySelector('div');
            if (div) div.style.color = textColor;
        } else {
            label.style.fill = textColor;
            label.style.color = textColor;
        }

        // Also check for span elements inside
        const spans = node.querySelectorAll('span');
        spans.forEach(span => {
            span.style.color = textColor;
        });
    });
}

// Handle slide keyboard navigation
function handleSlideKeydown(event) {
    if (!document.getElementById('study-slide-view')?.classList.contains('active')) return;

    // Don't intercept keyboard when user is typing in an input/textarea
    if (isUserTypingInInput()) return;

    // Check for step visualizer on current slide
    const activeSlide = document.querySelector('.slide.active');
    const activeViz = activeSlide?.querySelector('.slide-component.stepviz-immersive');

    // Step visualizer keyboard controls (ArrowUp/ArrowDown)
    if (activeViz && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const vizId = activeViz.id;
        if (event.key === 'ArrowUp') {
            stepVizPrev(vizId);
        } else {
            stepVizNext(vizId);
        }
        return;
    }

    // Space key - toggle play if stepviz exists, otherwise advance slide
    if (event.key === ' ') {
        event.preventDefault();
        if (activeViz) {
            stepVizTogglePlay(activeViz.id);
        } else {
            nextSlide();
        }
        return;
    }

    // O key - toggle overview mode for stepviz
    if ((event.key === 'o' || event.key === 'O') && activeViz) {
        event.preventDefault();
        stepVizToggleMode(activeViz.id);
        return;
    }

    if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextSlide();
    } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        prevSlide();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            exitSlideView();
        }
    } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        toggleSlideFullscreen();
    }
}

// Navigate to next slide
function nextSlide() {
    if (currentSlideIndex < slidesData.length - 1) {
        goToSlide(currentSlideIndex + 1);
    }
}

// Navigate to previous slide
function prevSlide() {
    if (currentSlideIndex > 0) {
        goToSlide(currentSlideIndex - 1);
    }
}

// Go to specific slide
function goToSlide(index) {
    if (index < 0 || index >= slidesData.length) return;

    const slides = document.querySelectorAll('.slide');
    const indicators = document.querySelectorAll('.slide-indicator');

    // Update slide classes
    slides.forEach((slide, i) => {
        slide.classList.remove('active', 'prev', 'next');
        if (i < index) {
            slide.classList.add('prev');
        } else if (i > index) {
            slide.classList.add('next');
        } else {
            slide.classList.add('active');
        }
    });

    // Update indicators
    indicators.forEach((ind, i) => {
        ind.classList.toggle('active', i === index);
    });

    // Update counter
    const counter = document.getElementById('slide-counter');
    if (counter) counter.textContent = `${index + 1} / ${slidesData.length}`;

    // Update nav buttons
    const prevBtn = document.getElementById('slide-prev-btn');
    const nextBtn = document.getElementById('slide-next-btn');
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === slidesData.length - 1;

    currentSlideIndex = index;

    // Render any unrendered Mermaid diagrams on new slide
    renderMermaidDiagrams();

    // Initialize step visualizers on new slide
    initStepVisualizers();
}

// Toggle fullscreen for slide view
function toggleSlideFullscreen() {
    const slideView = document.getElementById('study-slide-view');
    if (!slideView) return;

    if (!document.fullscreenElement) {
        // Enter fullscreen
        slideView.requestFullscreen().then(() => {
            slideView.classList.add('fullscreen');
            const btn = slideView.querySelector('.slide-fullscreen-btn i');
            if (btn) btn.className = 'fas fa-compress';
        }).catch(err => {
            console.error('Fullscreen error:', err);
            // Fallback: use CSS fullscreen mode
            slideView.classList.add('fullscreen');
            const btn = slideView.querySelector('.slide-fullscreen-btn i');
            if (btn) btn.className = 'fas fa-compress';
        });
    } else {
        // Exit fullscreen
        document.exitFullscreen().then(() => {
            slideView.classList.remove('fullscreen');
            const btn = slideView.querySelector('.slide-fullscreen-btn i');
            if (btn) btn.className = 'fas fa-expand';
        }).catch(err => {
            console.error('Exit fullscreen error:', err);
            slideView.classList.remove('fullscreen');
            const btn = slideView.querySelector('.slide-fullscreen-btn i');
            if (btn) btn.className = 'fas fa-expand';
        });
    }
}

// Listen for fullscreen changes to update button icon
document.addEventListener('fullscreenchange', () => {
    const slideView = document.getElementById('study-slide-view');
    if (!slideView) return;

    const btn = slideView.querySelector('.slide-fullscreen-btn i');
    if (!document.fullscreenElement) {
        slideView.classList.remove('fullscreen');
        if (btn) btn.className = 'fas fa-expand';
    } else {
        slideView.classList.add('fullscreen');
        if (btn) btn.className = 'fas fa-compress';
    }
});

// Exit slide view
function exitSlideView() {
    const chatPanel = document.getElementById('study-panel-chat');
    const historyPanel = document.getElementById('study-panel-history');
    const slideView = document.getElementById('study-slide-view');
    const inputArea = document.querySelector('.study-input-area');

    if (slideView) {
        slideView.classList.remove('active');
        slideView.innerHTML = '';
    }

    // Restore the correct panel based on which tab is active
    const isHistoryTab = document.getElementById('study-tab-history')?.classList.contains('active');

    if (isHistoryTab) {
        if (historyPanel) historyPanel.style.display = 'flex';
    } else {
        if (chatPanel) chatPanel.style.display = 'flex';
        if (inputArea) inputArea.style.display = 'block';
    }

    // Remove keyboard listener
    document.removeEventListener('keydown', handleSlideKeydown);

    // Clean up step visualizers (stop animations, clear state)
    cleanupStepVisualizers();

    // Don't re-add slides to chat - they're already there from when user clicked "View Slides"
    // This was causing duplication every time slides were viewed

    // Reset slide data
    slidesData = [];
    currentSlideIndex = 0;
}

// Update the chat bubble button to open Study panel instead
function updateChatBubbleToStudy() {
    const trigger = document.querySelector('.chat-bubble-trigger');
    if (trigger) {
        trigger.innerHTML = `<i class="fas fa-graduation-cap"></i>`;
        trigger.title = 'Study with Claude (Cmd/Ctrl+Shift+S)';
        trigger.onclick = () => openStudyWithClaude();
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Give existing code time to initialize chat bubble, then update it
    setTimeout(updateChatBubbleToStudy, 1000);
});

/**
 * PDF Page Selector
 * Allows users to select specific pages from a PDF for context reduction
 * Used in Study with Claude and TeX Editor Claude references
 */

// State
let pageSelectorPdf = null;
let pageSelectorCurrentPage = 1;
let pageSelectorTotalPages = 0;
let pageSelectorSelectedPages = new Set();
let pageSelectorFilePath = '';
let pageSelectorFileName = '';
let pageSelectorCallback = null;
let pageSelectorMode = 'select'; // 'full' or 'select'
let pageSelectorContext = 'study'; // 'study' or 'tex'

// Initialize the page selector
function initPdfPageSelector() {
    if (document.getElementById('pdf-page-selector-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'pdf-page-selector-overlay';
    overlay.className = 'pdf-page-selector-overlay';
    overlay.innerHTML = `
        <div class="pdf-page-selector-container">
            <!-- Header -->
            <div class="pdf-page-selector-header">
                <div class="pdf-page-selector-header-left">
                    <i class="fas fa-file-pdf"></i>
                    <div>
                        <h3>Select Pages</h3>
                        <div class="pdf-page-selector-file-name" id="page-selector-file-name"></div>
                    </div>
                </div>
                <button class="pdf-page-selector-close" onclick="closePageSelector()">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Mode Toggle -->
            <div class="pdf-page-selector-mode">
                <span class="pdf-page-selector-mode-label">Reference mode:</span>
                <div class="pdf-page-selector-mode-toggle">
                    <button class="pdf-page-selector-mode-btn active" id="mode-btn-full" onclick="setPageSelectorMode('full')">
                        <i class="fas fa-file"></i> Entire PDF
                    </button>
                    <button class="pdf-page-selector-mode-btn" id="mode-btn-select" onclick="setPageSelectorMode('select')">
                        <i class="fas fa-check-square"></i> Select Pages
                    </button>
                </div>
            </div>

            <!-- Page Viewer Area -->
            <div class="pdf-page-viewer-area" id="page-viewer-area">
                <button class="pdf-page-nav-btn prev" id="page-nav-prev" onclick="navigatePage(-1)">
                    <i class="fas fa-chevron-left"></i>
                </button>

                <div class="pdf-page-canvas-container" id="page-canvas-container">
                    <canvas id="page-selector-canvas" class="pdf-page-canvas"></canvas>
                    <div class="pdf-page-select-overlay" id="page-select-overlay" onclick="toggleCurrentPageSelection()">
                        <div class="select-icon">
                            <i class="fas fa-check"></i>
                        </div>
                    </div>
                </div>

                <button class="pdf-page-nav-btn next" id="page-nav-next" onclick="navigatePage(1)">
                    <i class="fas fa-chevron-right"></i>
                </button>

                <!-- Loading State -->
                <div class="pdf-page-loading" id="page-loading" style="display: none;">
                    <div class="spinner"></div>
                    <span>Loading PDF...</span>
                </div>
            </div>

            <!-- Page Info Bar -->
            <div class="pdf-page-info-bar">
                <div class="pdf-page-counter">
                    Page <span id="current-page-num">1</span> of <span id="total-pages-num">1</span>
                </div>
                <div class="pdf-page-jump">
                    <label>Go to:</label>
                    <input type="number" id="page-jump-input" min="1" max="1" value="1" onchange="jumpToPage(this.value)">
                </div>
            </div>

            <!-- Selection Summary -->
            <div class="pdf-page-selection-summary" id="selection-summary">
                <div class="pdf-page-selection-info">
                    <span class="pdf-page-selection-label">Selected pages:</span>
                    <div class="pdf-page-selection-chips" id="selection-chips">
                        <span class="pdf-page-selection-empty">No pages selected - will use entire PDF</span>
                    </div>
                </div>
                <div class="pdf-page-quick-select">
                    <button class="pdf-page-quick-btn" onclick="selectAllPages()">Select All</button>
                    <button class="pdf-page-quick-btn" onclick="clearPageSelection()">Clear</button>
                </div>
            </div>

            <!-- Footer -->
            <div class="pdf-page-selector-footer">
                <div class="pdf-page-selector-footer-left">
                    <div class="pdf-page-context-hint">
                        <i class="fas fa-lightbulb"></i>
                        <span>Select specific pages to reduce context and focus Claude's response</span>
                    </div>
                </div>
                <div class="pdf-page-selector-footer-right">
                    <div class="pdf-page-keyboard-hints">
                        <span><kbd>←</kbd> <kbd>→</kbd> navigate</span>
                        <span><kbd>Space</kbd> select</span>
                        <span><kbd>Esc</kbd> cancel</span>
                    </div>
                    <button class="pdf-page-selector-btn cancel" onclick="closePageSelector()">
                        Cancel
                    </button>
                    <button class="pdf-page-selector-btn confirm" id="confirm-selection-btn" onclick="confirmPageSelection()">
                        <i class="fas fa-check"></i> Confirm Selection
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Add keyboard event listener
    overlay.addEventListener('keydown', handlePageSelectorKeydown);
}

// Open page selector for a PDF file
async function openPageSelector(filePath, fileName, callback, context = 'study') {
    initPdfPageSelector();

    pageSelectorFilePath = filePath;
    pageSelectorFileName = fileName;
    pageSelectorCallback = callback;
    pageSelectorContext = context;
    pageSelectorSelectedPages.clear();
    pageSelectorCurrentPage = 1;
    pageSelectorMode = 'full'; // Default to full PDF

    // Update UI
    document.getElementById('page-selector-file-name').textContent = fileName;
    document.getElementById('selection-summary').style.display = pageSelectorMode === 'select' ? 'flex' : 'none';

    // Reset mode buttons
    document.getElementById('mode-btn-full').classList.add('active');
    document.getElementById('mode-btn-select').classList.remove('active');

    // Show loading
    document.getElementById('page-loading').style.display = 'flex';
    document.getElementById('page-canvas-container').style.display = 'none';

    // Open overlay
    const overlay = document.getElementById('pdf-page-selector-overlay');
    overlay.classList.add('open');
    overlay.focus();

    // Load PDF
    await loadPdfForSelector(filePath);

    // Hide loading, show canvas
    document.getElementById('page-loading').style.display = 'none';
    document.getElementById('page-canvas-container').style.display = 'flex';

    // Render first page
    await renderSelectorPage(1);
    updateSelectionUI();
}

// Load PDF using PDF.js
async function loadPdfForSelector(filePath) {
    try {
        // Load PDF.js if not loaded
        if (typeof pdfjsLib === 'undefined') {
            await loadPdfJsLibrary();
        }

        // Construct URL
        const pdfUrl = filePath.startsWith('/') ? filePath : '/' + filePath;

        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        pageSelectorPdf = await loadingTask.promise;
        pageSelectorTotalPages = pageSelectorPdf.numPages;

        // Update UI
        document.getElementById('total-pages-num').textContent = pageSelectorTotalPages;
        document.getElementById('page-jump-input').max = pageSelectorTotalPages;

    } catch (error) {
        console.error('Error loading PDF:', error);
        showNotification('Failed to load PDF', 3000);
    }
}

// Load PDF.js library dynamically
async function loadPdfJsLibrary() {
    return new Promise((resolve, reject) => {
        if (typeof pdfjsLib !== 'undefined') {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Render a specific page
async function renderSelectorPage(pageNum) {
    if (!pageSelectorPdf || pageNum < 1 || pageNum > pageSelectorTotalPages) return;

    pageSelectorCurrentPage = pageNum;

    try {
        const page = await pageSelectorPdf.getPage(pageNum);
        const canvas = document.getElementById('page-selector-canvas');
        const ctx = canvas.getContext('2d');

        // Calculate scale to fit within container
        const containerHeight = 380;
        const viewport = page.getViewport({ scale: 1 });
        const scale = containerHeight / viewport.height;
        const scaledViewport = page.getViewport({ scale });

        canvas.height = scaledViewport.height;
        canvas.width = scaledViewport.width;

        await page.render({
            canvasContext: ctx,
            viewport: scaledViewport
        }).promise;

        // Update page number display
        document.getElementById('current-page-num').textContent = pageNum;
        document.getElementById('page-jump-input').value = pageNum;

        // Update navigation buttons
        document.getElementById('page-nav-prev').disabled = pageNum === 1;
        document.getElementById('page-nav-next').disabled = pageNum === pageSelectorTotalPages;

        // Update selection overlay
        const overlay = document.getElementById('page-select-overlay');
        if (pageSelectorSelectedPages.has(pageNum)) {
            overlay.classList.add('selected');
        } else {
            overlay.classList.remove('selected');
        }

    } catch (error) {
        console.error('Error rendering page:', error);
    }
}

// Navigate to previous/next page
function navigatePage(delta) {
    const newPage = pageSelectorCurrentPage + delta;
    if (newPage >= 1 && newPage <= pageSelectorTotalPages) {
        renderSelectorPage(newPage);
    }
}

// Jump to specific page
function jumpToPage(pageNum) {
    const num = parseInt(pageNum);
    if (num >= 1 && num <= pageSelectorTotalPages) {
        renderSelectorPage(num);
    }
}

// Toggle selection of current page
function toggleCurrentPageSelection() {
    if (pageSelectorMode !== 'select') return;

    if (pageSelectorSelectedPages.has(pageSelectorCurrentPage)) {
        pageSelectorSelectedPages.delete(pageSelectorCurrentPage);
    } else {
        pageSelectorSelectedPages.add(pageSelectorCurrentPage);
    }

    updateSelectionUI();

    // Update overlay
    const overlay = document.getElementById('page-select-overlay');
    if (pageSelectorSelectedPages.has(pageSelectorCurrentPage)) {
        overlay.classList.add('selected');
    } else {
        overlay.classList.remove('selected');
    }
}

// Select all pages
function selectAllPages() {
    for (let i = 1; i <= pageSelectorTotalPages; i++) {
        pageSelectorSelectedPages.add(i);
    }
    updateSelectionUI();
    renderSelectorPage(pageSelectorCurrentPage);
}

// Clear all selections
function clearPageSelection() {
    pageSelectorSelectedPages.clear();
    updateSelectionUI();
    renderSelectorPage(pageSelectorCurrentPage);
}

// Update the selection UI (chips, button state)
function updateSelectionUI() {
    const chipsContainer = document.getElementById('selection-chips');
    const confirmBtn = document.getElementById('confirm-selection-btn');

    if (pageSelectorMode === 'full') {
        chipsContainer.innerHTML = '<span class="pdf-page-selection-empty">Using entire PDF</span>';
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> Use Entire PDF';
        confirmBtn.disabled = false;
        return;
    }

    if (pageSelectorSelectedPages.size === 0) {
        chipsContainer.innerHTML = '<span class="pdf-page-selection-empty">No pages selected - click pages to select</span>';
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> Select Pages First';
        confirmBtn.disabled = true;
        return;
    }

    // Sort pages
    const sortedPages = Array.from(pageSelectorSelectedPages).sort((a, b) => a - b);

    // Group consecutive pages into ranges
    const ranges = [];
    let rangeStart = sortedPages[0];
    let rangeEnd = sortedPages[0];

    for (let i = 1; i < sortedPages.length; i++) {
        if (sortedPages[i] === rangeEnd + 1) {
            rangeEnd = sortedPages[i];
        } else {
            ranges.push({ start: rangeStart, end: rangeEnd });
            rangeStart = sortedPages[i];
            rangeEnd = sortedPages[i];
        }
    }
    ranges.push({ start: rangeStart, end: rangeEnd });

    // Create chips
    chipsContainer.innerHTML = ranges.map(range => {
        const label = range.start === range.end ? `p${range.start}` : `p${range.start}-${range.end}`;
        return `
            <span class="pdf-page-chip">
                ${label}
                <span class="remove" onclick="removePageRange(${range.start}, ${range.end})">
                    <i class="fas fa-times"></i>
                </span>
            </span>
        `;
    }).join('');

    confirmBtn.innerHTML = `<i class="fas fa-check"></i> Use ${pageSelectorSelectedPages.size} Page${pageSelectorSelectedPages.size > 1 ? 's' : ''}`;
    confirmBtn.disabled = false;
}

// Remove a range of pages from selection
function removePageRange(start, end) {
    for (let i = start; i <= end; i++) {
        pageSelectorSelectedPages.delete(i);
    }
    updateSelectionUI();
    renderSelectorPage(pageSelectorCurrentPage);
}

// Set selection mode
function setPageSelectorMode(mode) {
    pageSelectorMode = mode;

    // Update buttons
    document.getElementById('mode-btn-full').classList.toggle('active', mode === 'full');
    document.getElementById('mode-btn-select').classList.toggle('active', mode === 'select');

    // Show/hide selection summary
    document.getElementById('selection-summary').style.display = mode === 'select' ? 'flex' : 'none';

    // Update canvas overlay interactivity
    const overlay = document.getElementById('page-select-overlay');
    overlay.style.pointerEvents = mode === 'select' ? 'auto' : 'none';
    overlay.style.display = mode === 'select' ? 'flex' : 'none';

    updateSelectionUI();
}

// Confirm selection and callback
async function confirmPageSelection() {
    const selectedPages = pageSelectorMode === 'full' ? null : Array.from(pageSelectorSelectedPages).sort((a, b) => a - b);

    if (pageSelectorMode === 'select' && selectedPages.length === 0) {
        showNotification('Please select at least one page', 3000);
        return;
    }

    // If selecting specific pages, extract them on the backend
    let resultPath = pageSelectorFilePath;
    let resultName = pageSelectorFileName;

    if (pageSelectorMode === 'select' && selectedPages.length > 0) {
        try {
            // Show loading
            const confirmBtn = document.getElementById('confirm-selection-btn');
            confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Extracting...';
            confirmBtn.disabled = true;

            const response = await fetch('/api/extract-pdf-pages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourcePath: pageSelectorFilePath,
                    pages: selectedPages
                })
            });

            const data = await response.json();

            if (data.success) {
                resultPath = data.extractedPath;
                resultName = `${pageSelectorFileName} (pages ${formatPageRange(selectedPages)})`;
            } else {
                showNotification('Failed to extract pages: ' + data.error, 4000);
                confirmBtn.innerHTML = '<i class="fas fa-check"></i> Confirm Selection';
                confirmBtn.disabled = false;
                return;
            }
        } catch (error) {
            console.error('Error extracting pages:', error);
            showNotification('Failed to extract pages', 3000);
            return;
        }
    }

    // Call the callback with the result
    if (pageSelectorCallback) {
        pageSelectorCallback({
            originalPath: pageSelectorFilePath,
            originalName: pageSelectorFileName,
            path: resultPath,
            name: resultName,
            pages: selectedPages,
            isExtracted: pageSelectorMode === 'select' && selectedPages && selectedPages.length > 0
        });
    }

    closePageSelector();
}

// Format page range for display
function formatPageRange(pages) {
    if (!pages || pages.length === 0) return 'all';

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

    return ranges.join(', ');
}

// Close the page selector
function closePageSelector() {
    const overlay = document.getElementById('pdf-page-selector-overlay');
    if (overlay) {
        overlay.classList.remove('open');
    }

    // Cleanup
    pageSelectorPdf = null;
    pageSelectorSelectedPages.clear();
    pageSelectorCallback = null;
}

// Handle keyboard events
function handlePageSelectorKeydown(event) {
    if (!document.getElementById('pdf-page-selector-overlay')?.classList.contains('open')) return;

    switch (event.key) {
        case 'ArrowLeft':
            event.preventDefault();
            navigatePage(-1);
            break;
        case 'ArrowRight':
            event.preventDefault();
            navigatePage(1);
            break;
        case ' ':
            event.preventDefault();
            if (pageSelectorMode === 'select') {
                toggleCurrentPageSelection();
            }
            break;
        case 'Escape':
            event.preventDefault();
            closePageSelector();
            break;
        case 'Enter':
            if (!event.target.matches('input')) {
                event.preventDefault();
                confirmPageSelection();
            }
            break;
    }
}

// Add global keyboard listener
document.addEventListener('keydown', (event) => {
    const overlay = document.getElementById('pdf-page-selector-overlay');
    if (overlay && overlay.classList.contains('open')) {
        handlePageSelectorKeydown(event);
    }
});

// Export functions for use by other modules
window.openPageSelector = openPageSelector;
window.closePageSelector = closePageSelector;

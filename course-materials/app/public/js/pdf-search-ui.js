/**
 * PDF Search UI Component
 * Integrates with the ML search engine and provides user interface
 */

class PDFSearchUI {
    constructor(searchEngine) {
        this.searchEngine = searchEngine;
        this.currentResults = [];
        this.isInitialized = false;
        this.searchTimeout = null;
    }

    /**
     * Initialize the search UI
     */
    init() {
        if (this.isInitialized) return;

        this.createSearchInterface();
        this.attachEventListeners();
        this.isInitialized = true;
    }

    /**
     * Create the search interface elements
     */
    createSearchInterface() {
        // Add search button to toolbar if not exists
        const toolbar = document.querySelector('.toolbar .container-fluid');
        if (toolbar && !document.getElementById('fast-search-btn')) {
            const searchBtn = document.createElement('button');
            searchBtn.id = 'fast-search-btn';
            searchBtn.className = 'btn btn-sm btn-outline-secondary toolbar-action-btn';
            searchBtn.innerHTML = '<i class="fas fa-file-search"></i> Find in PDFs Locally';
            searchBtn.style.marginLeft = '10px';
            searchBtn.onclick = () => this.toggleSearchPanel();

            const viewOptions = toolbar.querySelector('.view-options');
            if (viewOptions) {
                viewOptions.parentNode.insertBefore(searchBtn, viewOptions.nextSibling);
            }
        }

        // Create search panel
        if (!document.getElementById('fast-search-panel')) {
            const panel = document.createElement('div');
            panel.id = 'fast-search-panel';
            panel.className = 'fast-search-panel';
            panel.innerHTML = `
                <div class="search-panel-header">
                    <h3><i class="fas fa-file-search"></i> Find in Local Documents</h3>
                    <button class="search-panel-close" onclick="pdfSearchUI.toggleSearchPanel()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="search-panel-body">
                    <div class="search-input-container">
                        <i class="fas fa-search search-input-icon"></i>
                        <input type="text"
                               id="fast-search-input"
                               class="fast-search-input"
                               placeholder="Find text in your local documents...">
                    </div>
                    <div class="search-filters-compact">
                        <label class="checkbox-compact">
                            <input type="checkbox" id="filter-handouts">
                            <span class="check"></span>
                            <span>📄 Handouts Only</span>
                        </label>
                    </div>
                    <div class="search-results-container" id="search-results-container">
                        <div class="search-results-empty">
                            <i class="fas fa-search"></i>
                            <p>Find text in your local study materials</p>
                            <p class="text-muted small">Enter keywords or phrases from your notes</p>
                        </div>
                    </div>
                </div>
            `;

            document.body.appendChild(panel);
        }

        // Add sidebar search section
        const sidebar = document.querySelector('.sidebar');
        if (sidebar && !document.getElementById('fast-search-sidebar')) {
            const searchSection = document.createElement('div');
            searchSection.className = 'sidebar-section';
            searchSection.id = 'fast-search-sidebar';
            searchSection.innerHTML = `
                <div class="sidebar-header text-uppercase fw-bold">
                    <i class="fas fa-search text-info me-1"></i>Search
                </div>
                <div class="list-group list-group-flush">
                    <a href="#" class="list-group-item list-group-item-action sidebar-item"
                       onclick="pdfSearchUI.toggleSearchPanel(); return false;">
                        <span class="sidebar-icon"><i class="fas fa-file-search"></i></span>
                        <span>Find Text</span>
                    </a>
                    <div class="search-quick-stats" id="search-quick-stats">
                        <div class="stat-small">
                            <span class="stat-label">Documents:</span>
                            <span class="stat-value" id="indexed-count">Ready</span>
                        </div>
                    </div>
                </div>
            `;

            // Insert after favorites section
            const favSection = sidebar.querySelector('.sidebar-section');
            if (favSection && favSection.nextSibling) {
                sidebar.insertBefore(searchSection, favSection.nextSibling);
            } else {
                sidebar.appendChild(searchSection);
            }
        }
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        const searchInput = document.getElementById('fast-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchTimeout);
                this.searchTimeout = setTimeout(() => {
                    this.performSearch(e.target.value);
                }, 300); // Debounce search
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(this.searchTimeout);
                    this.performSearch(e.target.value);
                }
            });
        }

        // Filter checkbox
        const handoutsCheckbox = document.getElementById('filter-handouts');
        if (handoutsCheckbox) {
            handoutsCheckbox.addEventListener('change', () => {
                const searchInput = document.getElementById('fast-search-input');
                if (searchInput) {
                    this.performSearch(searchInput.value);
                }
            });
        }

        // Close panel with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('fast-search-panel');
                if (panel && panel.classList.contains('visible')) {
                    this.toggleSearchPanel();
                }
            }
        });
    }

    /**
     * Toggle search panel visibility
     */
    toggleSearchPanel() {
        const panel = document.getElementById('fast-search-panel');
        if (!panel) return;

        panel.classList.toggle('visible');

        if (panel.classList.contains('visible')) {
            // Focus search input
            setTimeout(() => {
                const input = document.getElementById('fast-search-input');
                if (input) input.focus();
            }, 100);

            // Check if we need to index
            if (this.searchEngine.index.size === 0 && !this.searchEngine.isIndexing) {
                this.indexAllPDFs();
            }
        }
    }

    /**
     * Perform search
     */
    async performSearch(query) {
        // Get filter state (only handouts filter now)
        const filterHandouts = document.getElementById('filter-handouts')?.checked || false;

        // If blank query, show suggestions
        if (!query || query.trim().length < 2) {
            this.showSuggestions(filterHandouts);
            return;
        }

        // Show loading state
        this.showLoadingState();

        try {
            const results = this.searchEngine.search(query, {
                maxResults: 50,
                minScore: 0.05,
                includePageContent: true,  // Include content for expand/preview feature
                filterHandouts
            });

            this.currentResults = results;
            this.displayResults(results, query);
        } catch (error) {
            console.error('Search error:', error);
            this.showErrorState('Search failed. Please try again.');
        }
    }

    /**
     * Show suggestions when search is blank
     */
    showSuggestions(filterHandouts) {
        const container = document.getElementById('search-results-container');
        if (!container) return;

        // Show empty state - no document browser
        container.innerHTML = `
            <div class="search-results-empty">
                <i class="fas fa-search"></i>
                <p>Find text in your local study materials</p>
                <p class="text-muted small">Enter keywords or phrases from your notes</p>
            </div>
        `;
    }

    /**
     * Open PDF from suggestion
     */
    openPDFFromSuggestion(path, title, category) {
        this.toggleSearchPanel();
        if (typeof openPDF === 'function') {
            openPDF(path, title, category);
        }
    }

    /**
     * Display search results
     */
    displayResults(results, query) {
        const container = document.getElementById('search-results-container');
        if (!container) return;

        if (results.length === 0) {
            container.innerHTML = `
                <div class="search-results-empty">
                    <i class="fas fa-inbox"></i>
                    <p>No results found for "${this.escapeHtml(query)}"</p>
                    <p class="text-muted small">Try different keywords</p>
                </div>
            `;
            return;
        }

        let html = `<div class="compact-results-header">${results.length} results</div>`;

        for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
            const result = results[resultIndex];
            const topPages = result.pages.slice(0, 3); // Show top 3 pages only
            const shortTitle = result.title.length > 45 ? result.title.substring(0, 42) + '...' : result.title;
            const resultId = `result-${resultIndex}`;

            html += `
                <div class="compact-result${result.tocPriority ? ' has-toc' : ''}" id="${resultId}">
                    <div class="compact-result-header" onclick="window.pdfSearchUI.openPDFAtPage('${this.escapeHtml(result.path)}', '${this.escapeHtml(result.title)}', '${this.escapeHtml(result.category)}', ${topPages[0]?.pageNumber || 1});">
                        <span class="compact-result-title">
                            ${this.escapeHtml(shortTitle)}
                        </span>
                        <span class="compact-result-icon"><i class="fas fa-file-pdf"></i></span>
                    </div>
                    <div class="compact-pages" id="${resultId}-pages">
            `;

            // Show top 3 pages (compact view)
            for (const page of topPages) {
                const preview = page.preview ? this.escapeHtml(page.preview).substring(0, 100) + '...' : '';
                html += `
                    <div class="compact-page" onclick="event.stopPropagation(); window.pdfSearchUI.openPDFAtPage('${this.escapeHtml(result.path)}', '${this.escapeHtml(result.title)}', '${this.escapeHtml(result.category)}', ${page.pageNumber});" title="${preview}">
                        <span class="compact-page-num">Page ${page.pageNumber}</span>
                    </div>
                `;
            }

            html += `</div>`; // Close compact-pages

            // Add expand button if there are more than 3 pages
            if (result.pages.length > 3) {
                html += `
                    <div class="compact-expand-section">
                        <button class="compact-expand-btn" onclick="event.stopPropagation(); window.pdfSearchUI.toggleExpand('${resultId}')">
                            <i class="fas fa-chevron-down"></i>
                            <span class="expand-text">Show all ${result.pages.length} pages with context</span>
                        </button>
                        <div class="compact-hidden-pages" id="${resultId}-hidden" style="display: none;">
                `;

                // Show ALL pages with full context when expanded (including the first 3)
                for (const page of result.pages) {
                    const preview = page.preview ? this.highlightText(this.escapeHtml(page.preview), query) : 'No preview available';
                    html += `
                        <div class="expanded-page-item" onclick="event.stopPropagation(); window.pdfSearchUI.openPDFAtPage('${this.escapeHtml(result.path)}', '${this.escapeHtml(result.title)}', '${this.escapeHtml(result.category)}', ${page.pageNumber});">
                            <div class="expanded-page-header">
                                <span class="expanded-page-num">Page ${page.pageNumber}</span>
                            </div>
                            <div class="expanded-page-preview">${preview}</div>
                        </div>
                    `;
                }

                html += `
                        </div>
                    </div>
                `;
            }

            html += `</div>`; // Close compact-result
        }

        container.innerHTML = html;
    }

    /**
     * Toggle expand/collapse for search results
     */
    toggleExpand(resultId) {
        const hiddenSection = document.getElementById(`${resultId}-hidden`);
        const expandBtn = document.querySelector(`#${resultId} .compact-expand-btn`);

        if (!hiddenSection || !expandBtn) return;

        const isExpanded = hiddenSection.style.display !== 'none';
        const totalPages = hiddenSection.querySelectorAll('.expanded-page-item').length;

        if (isExpanded) {
            // Collapse
            hiddenSection.style.display = 'none';
            expandBtn.innerHTML = `
                <i class="fas fa-chevron-down"></i>
                <span class="expand-text">Show all ${totalPages} pages with context</span>
            `;
        } else {
            // Expand
            hiddenSection.style.display = 'block';
            expandBtn.innerHTML = `
                <i class="fas fa-chevron-up"></i>
                <span class="expand-text">Hide detailed view</span>
            `;
        }
    }

    /**
     * Open PDF at specific page
     */
    openPDFAtPage(path, title, category, pageNumber) {
        // Close search panel first
        this.toggleSearchPanel();

        // CRITICAL: Add #page= fragment to the path for Chrome native viewer
        const pathWithPageFragment = `${path}#page=${pageNumber}`;

        console.log('Opening PDF at page:', pageNumber);
        console.log('Path with fragment:', pathWithPageFragment);

        // Get the modal and viewer elements
        const modal = document.getElementById('pdf-modal');
        const viewer = document.getElementById('pdf-viewer-left');
        const modalTitle = document.getElementById('modal-title');
        const modalSubtitle = document.getElementById('modal-subtitle');

        if (!modal || !viewer || !modalTitle || !modalSubtitle) {
            console.error('Modal elements not found!');
            return;
        }

        // Update global state if it exists
        if (typeof currentLeftPDF !== 'undefined') {
            window.currentLeftPDF = { title, path, category };
        }

        // Update modal content
        modalTitle.textContent = `${title} (Page ${pageNumber})`;
        modalSubtitle.textContent = category;

        // CRITICAL: Set the iframe src with the #page= fragment
        // Chrome's native PDF viewer will automatically navigate to that page via DOM
        viewer.src = pathWithPageFragment;

        // Show the modal
        modal.style.display = 'block';
        document.body.style.overflow = 'hidden';

        // Reset split view if it exists
        if (typeof isSplitView !== 'undefined' && isSplitView) {
            const paneRight = document.getElementById('pane-right');
            const paneLeft = document.getElementById('pane-left');
            const paneLeftHeader = document.getElementById('pane-left-header');
            const paneRightHeader = document.getElementById('pane-right-header');
            const viewerRight = document.getElementById('pdf-viewer-right');

            if (paneRight) paneRight.style.display = 'none';
            if (paneLeft) {
                paneLeft.classList.remove('split');
                paneLeft.style.flex = '1';
            }
            if (paneLeftHeader) paneLeftHeader.style.display = 'none';
            if (paneRightHeader) paneRightHeader.style.display = 'none';
            if (viewerRight) viewerRight.src = '';

            window.isSplitView = false;
        }

        // Save to history
        if (typeof saveToHistory === 'function') {
            saveToHistory(title, path, category, false);
        }

        // Setup focus tracking
        setTimeout(() => {
            if (typeof setupPaneFocusTracking === 'function') {
                setupPaneFocusTracking();
            }
        }, 500);

        // Show success notification
        if (typeof showNotification === 'function') {
            showNotification(`Opening ${title} at page ${pageNumber}`);
        }

        console.log('✅ PDF opened successfully with page fragment');
    }

    /**
     * Navigate to specific page in already-open PDF viewer
     */
    navigateToPage(pageNumber) {
        const viewer = document.getElementById('pdf-viewer-left');
        if (!viewer) return;

        // Get current source and update with new page number
        const currentSrc = viewer.src;
        const baseUrl = currentSrc.split('#')[0];
        const newUrl = `${baseUrl}#page=${pageNumber}`;

        // For Chrome native viewer, we need to reload with the fragment
        viewer.src = newUrl;

        // Show notification
        this.showNotification(`Navigating to page ${pageNumber}`, 'info');
    }

    /**
     * Index all PDFs
     */
    async indexAllPDFs() {
        if (typeof pdfStructure === 'undefined') {
            console.error('PDF structure not available');
            return;
        }

        this.showIndexingStatus(true);

        try {
            await this.searchEngine.indexAllPDFs(pdfStructure, (progress) => {
                this.updateIndexingProgress(progress);
            });

            this.showIndexingStatus(false);
            this.updateIndexedCount();

            // Show success message
            this.showNotification(`Search ready`, 'success');
        } catch (error) {
            console.error('Indexing error:', error);
            this.showIndexingStatus(false);
            this.showNotification('Failed to index PDFs. Please try again.', 'error');
        }
    }


    /**
     * Show indexing status
     */
    showIndexingStatus(show) {
        const status = document.getElementById('search-indexing-status');
        if (status) {
            status.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Update indexing progress
     */
    updateIndexingProgress(progress) {
        // Silent indexing - no visual progress indicator
    }

    /**
     * Update indexed count in sidebar
     */
    updateIndexedCount() {
        const countEl = document.getElementById('indexed-count');
        if (countEl) {
            countEl.textContent = 'Ready';
        }
    }

    /**
     * Show empty state
     */
    showEmptyState() {
        const container = document.getElementById('search-results-container');
        if (container) {
            container.innerHTML = `
                <div class="search-results-empty">
                    <i class="fas fa-search"></i>
                    <p>Enter a search query to find content across all PDFs</p>
                    <p class="text-muted small">Fast local text search across your documents</p>
                </div>
            `;
        }
    }

    /**
     * Show loading state
     */
    showLoadingState() {
        const container = document.getElementById('search-results-container');
        if (container) {
            container.innerHTML = `
                <div class="search-results-loading">
                    <div class="loading-spinner"></div>
                    <p>Searching...</p>
                </div>
            `;
        }
    }

    /**
     * Show error state
     */
    showErrorState(message) {
        const container = document.getElementById('search-results-container');
        if (container) {
            container.innerHTML = `
                <div class="search-results-empty">
                    <i class="fas fa-exclamation-triangle text-danger"></i>
                    <p>${this.escapeHtml(message)}</p>
                </div>
            `;
        }
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        // Use existing notification system if available
        if (typeof showNotification === 'function') {
            showNotification(message);
        } else {
            console.log(message);
        }
    }

    /**
     * Get color for score
     */
    getScoreColor(score) {
        if (score > 0.7) return 'linear-gradient(135deg, #34C759 0%, #30D158 100%)';
        if (score > 0.4) return 'linear-gradient(135deg, #FF9500 0%, #FF9F0A 100%)';
        return 'linear-gradient(135deg, #8E8E93 0%, #AEAEB2 100%)';
    }

    /**
     * Highlight search terms in text
     */
    highlightText(text, query) {
        if (!query || !text) return text;

        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
        let highlighted = text;

        // Sort terms by length (longest first) to avoid partial highlighting issues
        terms.sort((a, b) => b.length - a.length);

        for (const term of terms) {
            // Match whole words or partial matches
            const regex = new RegExp(`(${this.escapeRegex(term)}\\w*)`, 'gi');
            highlighted = highlighted.replace(regex, '<mark>$1</mark>');
        }

        // Clean up nested marks (if any)
        highlighted = highlighted.replace(/<mark>([^<]*)<mark>/g, '<mark>$1');
        highlighted = highlighted.replace(/<\/mark>([^<]*)<\/mark>/g, '$1</mark>');

        return highlighted;
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Escape regex special characters
     */
    escapeRegex(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

// Initialize when DOM is ready
// Make pdfSearchUI globally accessible
window.pdfSearchUI = null;

function initPDFSearch() {
    // Try to use Advanced engine, fallback to basic
    if (typeof AdvancedPDFSearchEngine !== 'undefined') {
        const searchEngine = new AdvancedPDFSearchEngine();
        window.pdfSearchUI = new PDFSearchUI(searchEngine);
        window.pdfSearchUI.init();
        console.log('PDF Search initialized');
    } else if (typeof PDFSearchEngine !== 'undefined') {
        const searchEngine = new PDFSearchEngine();
        window.pdfSearchUI = new PDFSearchUI(searchEngine);
        window.pdfSearchUI.init();
        console.log('PDF Search initialized');
    } else {
        console.error('PDF Search unavailable');
        return;
    }
}

// Auto-initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPDFSearch);
} else {
    initPDFSearch();
}

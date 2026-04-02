/**
 * LaTeX Project File Tree Component
 * Renders and manages the project file tree with drag-drop and context menu support
 */

class FileTree {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            onFileSelect: options.onFileSelect || (() => {}),
            onFileContextMenu: options.onFileContextMenu || (() => {}),
            onFolderToggle: options.onFolderToggle || (() => {}),
            mainFile: options.mainFile || 'main.tex'
        };
        this.selectedFile = null;
        this.expandedFolders = new Set(['chapters', 'figures']);
    }

    // Render the file tree
    render(files, mainFile = 'main.tex') {
        this.options.mainFile = mainFile;
        this.container.innerHTML = '';

        if (!files || files.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>No files in project</p>
                </div>
            `;
            return;
        }

        const tree = this.buildTreeElement(files);
        this.container.appendChild(tree);
    }

    // Build tree element recursively
    buildTreeElement(items, level = 0) {
        const ul = document.createElement('ul');
        ul.className = 'file-tree-list';
        ul.style.paddingLeft = level === 0 ? '0' : '16px';

        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'file-tree-item';
            li.dataset.path = item.path;
            li.dataset.type = item.type;

            if (item.type === 'folder') {
                li.innerHTML = this.createFolderElement(item);
                li.classList.add('folder');

                // Add children if expanded
                if (item.children && item.children.length > 0) {
                    const childContainer = document.createElement('div');
                    childContainer.className = 'folder-children';
                    childContainer.style.display = this.expandedFolders.has(item.path) ? 'block' : 'none';
                    childContainer.appendChild(this.buildTreeElement(item.children, level + 1));
                    li.appendChild(childContainer);
                }

                // Folder click handler
                const folderHeader = li.querySelector('.folder-header');
                folderHeader.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleFolder(item.path, li);
                });
            } else {
                li.innerHTML = this.createFileElement(item);
                li.classList.add('file');

                // File click handler
                li.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectFile(item.path, li);
                });

                // Double click to open
                li.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    this.options.onFileSelect(item.path, item.fileType);
                });
            }

            // Context menu
            li.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.options.onFileContextMenu(e, item);
            });

            ul.appendChild(li);
        });

        return ul;
    }

    // Create folder element HTML
    createFolderElement(item) {
        const isExpanded = this.expandedFolders.has(item.path);
        const icon = isExpanded ? 'fa-folder-open' : 'fa-folder';
        const chevron = isExpanded ? 'fa-chevron-down' : 'fa-chevron-right';

        return `
            <div class="folder-header">
                <i class="fas ${chevron} folder-chevron"></i>
                <i class="fas ${icon} folder-icon"></i>
                <span class="folder-name">${item.name}</span>
            </div>
        `;
    }

    // Create file element HTML
    createFileElement(item) {
        const icon = this.getFileIcon(item.fileType);
        const isMain = item.path === this.options.mainFile;

        return `
            <div class="file-entry ${isMain ? 'main-file' : ''}">
                <i class="fas ${icon} file-icon"></i>
                <span class="file-name">${item.name}</span>
                ${isMain ? '<i class="fas fa-star main-indicator" title="Main file"></i>' : ''}
            </div>
        `;
    }

    // Get icon for file type
    getFileIcon(fileType) {
        const icons = {
            'tex': 'fa-file-code',
            'bib': 'fa-book',
            'cls': 'fa-file-alt',
            'sty': 'fa-file-alt',
            'pdf': 'fa-file-pdf',
            'png': 'fa-file-image',
            'jpg': 'fa-file-image',
            'jpeg': 'fa-file-image',
            'svg': 'fa-file-image',
            'eps': 'fa-file-image',
            'txt': 'fa-file-alt'
        };
        return icons[fileType] || 'fa-file';
    }

    // Toggle folder expansion
    toggleFolder(path, element) {
        const childContainer = element.querySelector('.folder-children');
        const chevron = element.querySelector('.folder-chevron');
        const folderIcon = element.querySelector('.folder-icon');

        if (this.expandedFolders.has(path)) {
            this.expandedFolders.delete(path);
            if (childContainer) childContainer.style.display = 'none';
            chevron.className = 'fas fa-chevron-right folder-chevron';
            folderIcon.className = 'fas fa-folder folder-icon';
        } else {
            this.expandedFolders.add(path);
            if (childContainer) childContainer.style.display = 'block';
            chevron.className = 'fas fa-chevron-down folder-chevron';
            folderIcon.className = 'fas fa-folder-open folder-icon';
        }

        this.options.onFolderToggle(path, this.expandedFolders.has(path));
    }

    // Select a file
    selectFile(path, element) {
        // Remove previous selection
        const previousSelected = this.container.querySelector('.file-tree-item.selected');
        if (previousSelected) {
            previousSelected.classList.remove('selected');
        }

        // Add selection to current
        element.classList.add('selected');
        this.selectedFile = path;
    }

    // Get selected file
    getSelectedFile() {
        return this.selectedFile;
    }

    // Expand to file (expand all parent folders)
    expandToFile(filePath) {
        const parts = filePath.split('/');
        let currentPath = '';

        for (let i = 0; i < parts.length - 1; i++) {
            currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
            this.expandedFolders.add(currentPath);
        }
    }

    // Highlight file in tree
    highlightFile(filePath) {
        this.expandToFile(filePath);

        // Re-render to show expanded folders
        // Then select the file
        const fileElement = this.container.querySelector(`[data-path="${filePath}"]`);
        if (fileElement) {
            this.selectFile(filePath, fileElement);
            fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// Tab Manager for multi-file editing
class TabManager {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.tabs = new Map(); // path -> { content, modified, element }
        this.activeTab = null;
        this.options = {
            onTabSwitch: options.onTabSwitch || (() => {}),
            onTabClose: options.onTabClose || (() => {}),
            onAllTabsClosed: options.onAllTabsClosed || (() => {})
        };
    }

    // Open a file in a new tab or switch to existing
    openTab(path, content = '', fileType = 'tex', metadata = {}) {
        if (this.tabs.has(path)) {
            this.switchToTab(path);
            return;
        }

        // Create tab element
        const tabElement = document.createElement('div');
        tabElement.className = 'editor-tab';
        tabElement.dataset.path = path;

        const fileName = path.split('/').pop();
        const icon = this.getFileIcon(fileType);

        tabElement.innerHTML = `
            <i class="fas ${icon} tab-icon"></i>
            <span class="tab-name">${fileName}</span>
            <span class="tab-modified" style="display: none;">*</span>
            <button class="tab-close" title="Close">
                <i class="fas fa-times"></i>
            </button>
        `;

        // Tab click handler
        tabElement.addEventListener('click', (e) => {
            if (!e.target.closest('.tab-close')) {
                this.switchToTab(path);
            }
        });

        // Close button handler
        tabElement.querySelector('.tab-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(path);
        });

        this.container.appendChild(tabElement);

        // Store tab data with metadata
        this.tabs.set(path, {
            content: content,
            modified: false,
            element: tabElement,
            fileType: fileType,
            metadata: metadata // Store metadata (isSpecialViewer, viewerType, rawUrl, etc.)
        });

        // Switch to the new tab
        this.switchToTab(path);
    }

    // Switch to a tab
    switchToTab(path) {
        if (!this.tabs.has(path)) return;

        // Store previous tab BEFORE changing activeTab
        const previousTab = this.activeTab;

        // Deactivate current tab
        if (this.activeTab) {
            const currentTabData = this.tabs.get(this.activeTab);
            if (currentTabData) {
                currentTabData.element.classList.remove('active');
            }
        }

        // Activate new tab
        const tabData = this.tabs.get(path);
        tabData.element.classList.add('active');
        this.activeTab = path;

        // Pass previousTab and metadata so callback can handle special viewers
        this.options.onTabSwitch(path, tabData.content, tabData.fileType, previousTab, tabData.metadata || {});
    }

    // Get tab metadata
    getTabMetadata(path) {
        if (this.tabs.has(path)) {
            return this.tabs.get(path).metadata || {};
        }
        return {};
    }

    // Close a tab
    closeTab(path) {
        if (!this.tabs.has(path)) return;

        const tabData = this.tabs.get(path);

        // Check for unsaved changes
        if (tabData.modified) {
            if (!confirm(`${path} has unsaved changes. Close anyway?`)) {
                return;
            }
        }

        // Remove tab element
        tabData.element.remove();
        this.tabs.delete(path);

        // If this was the active tab, switch to another
        if (this.activeTab === path) {
            this.activeTab = null;

            if (this.tabs.size > 0) {
                // Switch to the last tab
                const lastPath = Array.from(this.tabs.keys()).pop();
                this.switchToTab(lastPath);
            } else {
                this.options.onAllTabsClosed();
            }
        }

        this.options.onTabClose(path);
    }

    // Update tab content (for saving state before switch)
    updateTabContent(path, content) {
        if (this.tabs.has(path)) {
            this.tabs.get(path).content = content;
        }
    }

    // Mark tab as modified
    setModified(path, modified = true) {
        if (!this.tabs.has(path)) return;

        const tabData = this.tabs.get(path);
        tabData.modified = modified;

        const modifiedIndicator = tabData.element.querySelector('.tab-modified');
        modifiedIndicator.style.display = modified ? 'inline' : 'none';

        if (modified) {
            tabData.element.classList.add('modified');
        } else {
            tabData.element.classList.remove('modified');
        }
    }

    // Get current tab
    getCurrentTab() {
        return this.activeTab;
    }

    // Get tab content
    getTabContent(path) {
        if (this.tabs.has(path)) {
            return this.tabs.get(path).content;
        }
        return null;
    }

    // Check if any tabs have unsaved changes
    hasUnsavedChanges() {
        for (const [path, data] of this.tabs) {
            if (data.modified) return true;
        }
        return false;
    }

    // Get all open tabs
    getOpenTabs() {
        return Array.from(this.tabs.keys());
    }

    // Get file icon
    getFileIcon(fileType) {
        const icons = {
            'tex': 'fa-file-code',
            'bib': 'fa-book',
            'cls': 'fa-file-alt',
            'sty': 'fa-file-alt',
            'pdf': 'fa-file-pdf',
            'png': 'fa-file-image',
            'jpg': 'fa-file-image'
        };
        return icons[fileType] || 'fa-file';
    }
}

// Export for use
window.FileTree = FileTree;
window.TabManager = TabManager;

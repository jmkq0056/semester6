/**
 * File Viewers for LaTeX Project Editor
 * Handles preview of images (png, jpg, eps, svg), markdown, and other file types
 */

class FileViewers {
    constructor() {
        this.supportedImageTypes = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'eps', 'pdf'];
        this.supportedTextTypes = ['md', 'markdown', 'txt', 'json', 'xml', 'csv'];
        this.currentViewer = null;
    }

    /**
     * Check if file type needs special viewer (not CodeMirror)
     */
    needsSpecialViewer(fileType) {
        const type = fileType.toLowerCase();
        return this.supportedImageTypes.includes(type) ||
               type === 'md' || type === 'markdown';
    }

    /**
     * Check if file is an image
     */
    isImage(fileType) {
        return this.supportedImageTypes.includes(fileType.toLowerCase());
    }

    /**
     * Check if file is markdown
     */
    isMarkdown(fileType) {
        const type = fileType.toLowerCase();
        return type === 'md' || type === 'markdown';
    }

    /**
     * Get appropriate viewer for file type
     */
    getViewerType(fileType) {
        const type = fileType.toLowerCase();
        if (this.supportedImageTypes.includes(type)) {
            return 'image';
        }
        if (type === 'md' || type === 'markdown') {
            return 'markdown';
        }
        return 'code'; // Default to CodeMirror
    }

    /**
     * Create image viewer element
     */
    createImageViewer(src, fileName, fileType) {
        const container = document.createElement('div');
        container.className = 'file-viewer image-viewer';

        const isEps = fileType.toLowerCase() === 'eps';
        const isPdf = fileType.toLowerCase() === 'pdf';

        if (isEps) {
            // EPS files - show info and conversion option
            container.innerHTML = `
                <div class="viewer-header">
                    <i class="fas fa-file-image"></i>
                    <span>${fileName}</span>
                    <span class="file-type-badge">EPS</span>
                </div>
                <div class="eps-viewer">
                    <div class="eps-info">
                        <i class="fas fa-vector-square"></i>
                        <h3>EPS Vector Image</h3>
                        <p>EPS files are vector graphics commonly used in LaTeX documents.</p>
                        <p class="hint">This file will be included properly when compiling your LaTeX document.</p>
                    </div>
                    <div class="eps-actions">
                        <button class="btn-viewer" onclick="fileViewers.openInNewTab('${src}')">
                            <i class="fas fa-external-link-alt"></i> Download / Open
                        </button>
                        <button class="btn-viewer secondary" onclick="fileViewers.showEpsIncludeCode('${fileName}')">
                            <i class="fas fa-code"></i> Copy LaTeX Include
                        </button>
                    </div>
                </div>
            `;
        } else if (isPdf) {
            // PDF files - embed viewer
            container.innerHTML = `
                <div class="viewer-header">
                    <i class="fas fa-file-pdf"></i>
                    <span>${fileName}</span>
                    <span class="file-type-badge pdf">PDF</span>
                </div>
                <div class="pdf-embed-viewer">
                    <iframe src="${src}" frameborder="0"></iframe>
                </div>
                <div class="viewer-actions">
                    <button class="btn-viewer" onclick="fileViewers.openInNewTab('${src}')">
                        <i class="fas fa-external-link-alt"></i> Open in New Tab
                    </button>
                </div>
            `;
        } else {
            // Regular images (png, jpg, svg, etc.)
            container.innerHTML = `
                <div class="viewer-header">
                    <i class="fas fa-file-image"></i>
                    <span>${fileName}</span>
                    <span class="file-type-badge">${fileType.toUpperCase()}</span>
                </div>
                <div class="image-preview">
                    <img src="${src}" alt="${fileName}" onerror="fileViewers.handleImageError(this)">
                </div>
                <div class="viewer-actions">
                    <button class="btn-viewer" onclick="fileViewers.openInNewTab('${src}')">
                        <i class="fas fa-external-link-alt"></i> Open Full Size
                    </button>
                    <button class="btn-viewer secondary" onclick="fileViewers.showImageIncludeCode('${fileName}')">
                        <i class="fas fa-code"></i> Copy LaTeX Include
                    </button>
                </div>
            `;
        }

        return container;
    }

    /**
     * Create markdown viewer element
     */
    createMarkdownViewer(content, fileName) {
        const container = document.createElement('div');
        container.className = 'file-viewer markdown-viewer';

        const renderedHtml = this.renderMarkdown(content);

        container.innerHTML = `
            <div class="viewer-header">
                <i class="fab fa-markdown"></i>
                <span>${fileName}</span>
                <span class="file-type-badge md">Markdown</span>
                <div class="viewer-toggle">
                    <button class="toggle-btn active" data-view="preview" onclick="fileViewers.toggleMarkdownView(this, 'preview')">
                        <i class="fas fa-eye"></i> Preview
                    </button>
                    <button class="toggle-btn" data-view="source" onclick="fileViewers.toggleMarkdownView(this, 'source')">
                        <i class="fas fa-code"></i> Source
                    </button>
                </div>
            </div>
            <div class="markdown-content">
                <div class="markdown-preview active">${renderedHtml}</div>
                <div class="markdown-source"><pre><code>${this.escapeHtml(content)}</code></pre></div>
            </div>
        `;

        return container;
    }

    /**
     * Simple markdown renderer (basic support)
     */
    renderMarkdown(text) {
        if (!text) return '<p class="empty-content">Empty file</p>';

        let html = text;

        // Escape HTML first
        html = this.escapeHtml(html);

        // Headers
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Bold and italic
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        html = html.replace(/_(.+?)_/g, '<em>$1</em>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Code blocks
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

        // Images (in markdown)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

        // Horizontal rule
        html = html.replace(/^---+$/gm, '<hr>');
        html = html.replace(/^\*\*\*+$/gm, '<hr>');

        // Unordered lists
        html = html.replace(/^\s*[-*+]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Ordered lists
        html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>');

        // Blockquotes
        html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

        // Paragraphs (double newlines)
        html = html.replace(/\n\n+/g, '</p><p>');
        html = '<p>' + html + '</p>';

        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');
        html = html.replace(/<p>(<h[1-6]>)/g, '$1');
        html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1');
        html = html.replace(/<p>(<ul>)/g, '$1');
        html = html.replace(/(<\/ul>)<\/p>/g, '$1');
        html = html.replace(/<p>(<pre>)/g, '$1');
        html = html.replace(/(<\/pre>)<\/p>/g, '$1');
        html = html.replace(/<p>(<blockquote>)/g, '$1');
        html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
        html = html.replace(/<p>(<hr>)<\/p>/g, '$1');

        return html;
    }

    /**
     * Toggle markdown view between preview and source
     */
    toggleMarkdownView(btn, view) {
        const container = btn.closest('.markdown-viewer');
        const buttons = container.querySelectorAll('.toggle-btn');
        const preview = container.querySelector('.markdown-preview');
        const source = container.querySelector('.markdown-source');

        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (view === 'preview') {
            preview.classList.add('active');
            source.classList.remove('active');
        } else {
            source.classList.add('active');
            preview.classList.remove('active');
        }
    }

    /**
     * Show LaTeX include code for images
     */
    showImageIncludeCode(fileName) {
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const code = `\\includegraphics[width=\\textwidth]{${baseName}}`;

        this.copyToClipboard(code);
        this.showNotification('LaTeX include code copied!', 'success');
    }

    /**
     * Show LaTeX include code for EPS files
     */
    showEpsIncludeCode(fileName) {
        const baseName = fileName.replace(/\.[^.]+$/, '');
        const code = `\\includegraphics[width=\\textwidth]{${baseName}}`;

        this.copyToClipboard(code);
        this.showNotification('LaTeX include code copied!', 'success');
    }

    /**
     * Open file in new tab
     */
    openInNewTab(url) {
        window.open(url, '_blank');
    }

    /**
     * Handle image load error
     */
    handleImageError(img) {
        const container = img.closest('.image-preview');
        if (container) {
            container.innerHTML = `
                <div class="image-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Failed to load image</p>
                    <p class="hint">The image may be corrupted or in an unsupported format.</p>
                </div>
            `;
        }
    }

    /**
     * Copy text to clipboard
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {
            // Fallback for older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            return true;
        }
    }

    /**
     * Show notification (uses global showNotification if available)
     */
    showNotification(message, type = 'info') {
        if (typeof window.showNotification === 'function') {
            window.showNotification(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    /**
     * Escape HTML special characters
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Build URL for project file
     */
    buildFileUrl(projectId, filePath) {
        return `/api/latex-projects/${projectId}/files/${filePath}/raw`;
    }

    /**
     * Destroy current viewer
     */
    destroyCurrentViewer() {
        if (this.currentViewer && this.currentViewer.parentNode) {
            this.currentViewer.parentNode.removeChild(this.currentViewer);
        }
        this.currentViewer = null;
    }
}

// Create global instance
const fileViewers = new FileViewers();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FileViewers, fileViewers };
}

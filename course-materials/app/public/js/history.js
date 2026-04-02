// History page JavaScript

let allHistoryItems = [];
let filteredHistoryItems = [];

// Load history on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadCurrentSubject();
    await loadFullHistory();
    await loadStatistics();
});

// Load current subject info
async function loadCurrentSubject() {
    try {
        const response = await fetch('/api/current-subject');
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.subject) {
                const breadcrumbElement = document.getElementById('breadcrumb-subject');
                if (breadcrumbElement) {
                    breadcrumbElement.textContent = data.subject.name.toLowerCase();
                }
            }
        }
    } catch (e) {
        console.error('Failed to load current subject:', e);
    }
}

// Load all history items
async function loadFullHistory() {
    try {
        const response = await fetch('/api/history?limit=1000');
        if (!response.ok) {
            throw new Error('Failed to fetch history');
        }

        allHistoryItems = await response.json();
        filteredHistoryItems = [...allHistoryItems];
        renderHistory();
    } catch (e) {
        console.error('Failed to load history:', e);
        document.getElementById('history-empty').style.display = 'block';
    }
}

// Load statistics
async function loadStatistics() {
    try {
        const response = await fetch('/api/statistics');
        if (!response.ok) {
            throw new Error('Failed to fetch statistics');
        }

        const stats = await response.json();
        
        document.getElementById('stat-total-views').textContent = stats.totalViews || 0;
        document.getElementById('stat-unique-pdfs').textContent = stats.uniquePDFs || 0;
        document.getElementById('stat-split-views').textContent = stats.splitViewUsage || 0;

        // Render most viewed
        const mostViewedList = document.getElementById('most-viewed-list');
        if (stats.mostViewed && stats.mostViewed.length > 0) {
            mostViewedList.innerHTML = stats.mostViewed.map(item => `
                <div class="most-viewed-item" onclick="openPDF('${escapeHtml(item.path)}')">
                    <div class="most-viewed-title">${escapeHtml(item.title)}</div>
                    <div class="most-viewed-count">${item.access_count} views</div>
                </div>
            `).join('');
        } else {
            mostViewedList.innerHTML = '<div class="history-empty">No data yet</div>';
        }
    } catch (e) {
        console.error('Failed to load statistics:', e);
    }
}

// Render history grid
function renderHistory() {
    const historyGrid = document.getElementById('history-grid');
    const emptyState = document.getElementById('history-empty');

    if (filteredHistoryItems.length === 0) {
        historyGrid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    historyGrid.innerHTML = filteredHistoryItems.map(item => {
        const timeAgo = getTimeAgo(item.timestamp);
        const splitBadge = item.wasSplitView 
            ? '<span class="history-card-badge">⚏ Split View</span>' 
            : '';
        
        return `
            <div class="history-card" onclick="openPDF('${escapeHtml(item.path)}')">
                <div class="history-card-icon">📄</div>
                <div class="history-card-content">
                    <div class="history-card-title">${escapeHtml(item.title)}</div>
                    <div class="history-card-category">${escapeHtml(item.category || 'Uncategorized')}</div>
                    <div class="history-card-meta">
                        <span class="history-card-time">${timeAgo}</span>
                        ${splitBadge}
                    </div>
                    <div class="history-card-views">${item.accessCount || 1} ${item.accessCount === 1 ? 'view' : 'views'}</div>
                </div>
            </div>
        `;
    }).join('');
}

// Filter history
function filterHistory() {
    const searchTerm = document.getElementById('history-search').value.toLowerCase();
    
    if (!searchTerm) {
        filteredHistoryItems = [...allHistoryItems];
    } else {
        filteredHistoryItems = allHistoryItems.filter(item => 
            item.title.toLowerCase().includes(searchTerm) ||
            (item.category && item.category.toLowerCase().includes(searchTerm))
        );
    }
    
    renderHistory();
}

// Clear all history
async function clearAllHistory() {
    if (!confirm('Clear all history? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch('/api/history', { method: 'DELETE' });
        if (response.ok) {
            allHistoryItems = [];
            filteredHistoryItems = [];
            renderHistory();
            await loadStatistics();
            showNotification('History cleared');
        }
    } catch (e) {
        console.error('Failed to clear history:', e);
        showNotification('Failed to clear history', 3000);
    }
}

// Export history
async function exportHistory() {
    try {
        const response = await fetch('/api/export');
        if (!response.ok) {
            throw new Error('Failed to export data');
        }

        const data = await response.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pdf-viewer-history-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification('History exported');
    } catch (e) {
        console.error('Failed to export history:', e);
        showNotification('Failed to export history', 3000);
    }
}

// Open PDF (redirect to main page with PDF)
function openPDF(path) {
    window.location.href = `/?left=${encodeURIComponent(path)}`;
}

// Time ago helper
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
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    return `${month} ${day}`;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show notification
function showNotification(message, duration = 2000) {
    // Simple notification - you can enhance this
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10000;
        font-size: 14px;
        backdrop-filter: blur(20px);
    `;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.transition = 'opacity 0.3s';
        notification.style.opacity = '0';
        setTimeout(() => document.body.removeChild(notification), 300);
    }, duration);
}



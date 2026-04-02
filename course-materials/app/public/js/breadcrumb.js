// ============================================================================
// INTERACTIVE BREADCRUMB NAVIGATION
// ============================================================================

// Initialize breadcrumb dropdowns
document.addEventListener('DOMContentLoaded', function() {
    initBreadcrumbDropdowns();
    populateBreadcrumbSubjects();
    updateBreadcrumbSubject();
});

// ============================================================================
// DROPDOWN FUNCTIONALITY
// ============================================================================

function initBreadcrumbDropdowns() {
    // Get all dropdown triggers
    const triggers = document.querySelectorAll('.breadcrumb-dropdown-trigger');

    triggers.forEach(trigger => {
        trigger.addEventListener('click', function(e) {
            e.stopPropagation();
            const dropdown = this.closest('.breadcrumb-dropdown');

            // Close all other dropdowns
            document.querySelectorAll('.breadcrumb-dropdown').forEach(d => {
                if (d !== dropdown) {
                    d.classList.remove('active');
                }
            });

            // Toggle this dropdown
            dropdown.classList.toggle('active');
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.breadcrumb-dropdown')) {
            closeBreadcrumbDropdowns();
        }
    });

    // Close on escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeBreadcrumbDropdowns();
        }
    });
}

function closeBreadcrumbDropdowns() {
    document.querySelectorAll('.breadcrumb-dropdown').forEach(dropdown => {
        dropdown.classList.remove('active');
    });
}

// ============================================================================
// POPULATE SUBJECTS IN BREADCRUMB
// ============================================================================

async function populateBreadcrumbSubjects() {
    try {
        const response = await fetch('/api/subjects');
        const data = await response.json();

        if (!data.success) return;

        const menu = document.getElementById('breadcrumb-subjects-menu');
        if (!menu) return;

        menu.innerHTML = '';

        // Get current subject
        const currentResponse = await fetch('/api/current-subject');
        const currentData = await currentResponse.json();
        const currentSubjectCode = currentData.subject ? currentData.subject.code : null;

        // Add each subject
        data.subjects.forEach(subject => {
            const item = document.createElement('a');
            item.href = '#';
            item.className = 'breadcrumb-menu-item';
            if (subject.code === currentSubjectCode) {
                item.classList.add('active');
            }

            const iconHtml = subject.custom_svg
                ? `<span style="width: 14px; text-align: center; display: inline-flex; align-items: center; justify-content: center;">${subject.custom_svg}</span>`
                : `<i class="fas ${subject.icon || 'fa-book'}"></i>`;

            item.innerHTML = `
                ${iconHtml}
                <span>${subject.name}</span>
            `;

            item.onclick = async (e) => {
                e.preventDefault();
                await switchSubjectFromBreadcrumb(subject.code);
            };

            menu.appendChild(item);
        });

        // Add divider
        const divider = document.createElement('div');
        divider.style.cssText = 'height: 1px; background: #e8e8ed; margin: 4px 0;';
        menu.appendChild(divider);

        // Add "Manage Subjects" link
        const manageItem = document.createElement('a');
        manageItem.href = '/subjects.html';
        manageItem.className = 'breadcrumb-menu-item';
        manageItem.innerHTML = `
            <i class="fas fa-cog"></i>
            <span>Manage Subjects...</span>
        `;
        menu.appendChild(manageItem);

    } catch (error) {
        console.error('Error populating breadcrumb subjects:', error);
    }
}

async function switchSubjectFromBreadcrumb(code) {
    try {
        const response = await fetch('/api/set-current-subject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        if (response.ok) {
            window.location.reload();
        }
    } catch (error) {
        console.error('Error switching subject:', error);
    }
}

// ============================================================================
// UPDATE BREADCRUMB DISPLAY
// ============================================================================

async function updateBreadcrumbSubject() {
    try {
        const response = await fetch('/api/current-subject');
        const data = await response.json();

        if (!data.success || !data.subject) return;

        const subject = data.subject;

        // Update subject name
        const subjectNameEl = document.getElementById('breadcrumb-subject');
        if (subjectNameEl) {
            subjectNameEl.textContent = subject.name;
        }

        // Update subject icon
        const subjectIconEl = document.getElementById('breadcrumb-subject-icon');
        if (subjectIconEl) {
            if (subject.custom_svg) {
                subjectIconEl.outerHTML = subject.custom_svg;
            } else {
                subjectIconEl.className = `fas ${subject.icon || 'fa-book'}`;
            }
        }

        // Update local path display
        if (typeof updateLocalPathDisplay === 'function') {
            updateLocalPathDisplay();
        }

    } catch (error) {
        console.error('Error updating breadcrumb subject:', error);
    }
}

// Update location text when filtering
function updateBreadcrumbLocation(categoryName) {
    const locationEl = document.getElementById('current-location');
    if (!locationEl) return;

    const categoryNames = {
        'all': 'All Files',
        'notes': 'Lecture Notes',
        'slides': 'Lecture Slides',
        'exercises': 'Exercises',
        'exercises-no-solutions': 'Exercises (No Solutions)',
        'blueprint': 'Blueprint',
        'teachers-method': 'Teachers Method'
    };

    locationEl.textContent = categoryNames[categoryName] || 'All Files';

    // Update active state in menu
    const menuItems = document.querySelectorAll('#breadcrumb-view-menu .breadcrumb-menu-item');
    menuItems.forEach(item => {
        const text = item.querySelector('span').textContent.toLowerCase();
        const expected = (categoryNames[categoryName] || 'All Files').toLowerCase();

        if (text === expected) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

// Override the filterByCategory function to update breadcrumb
const originalFilterByCategory = window.filterByCategory;
if (originalFilterByCategory) {
    window.filterByCategory = function(category) {
        originalFilterByCategory(category);
        updateBreadcrumbLocation(category);
    };
}

// ============================================================================
// KEYBOARD NAVIGATION
// ============================================================================

document.addEventListener('keydown', function(e) {
    // Alt/Option + B to focus breadcrumb
    if ((e.altKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        const firstBreadcrumbBtn = document.querySelector('.breadcrumb-btn');
        if (firstBreadcrumbBtn) {
            firstBreadcrumbBtn.focus();
        }
    }
});

// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

window.closeBreadcrumbDropdowns = closeBreadcrumbDropdowns;
window.updateBreadcrumbLocation = updateBreadcrumbLocation;
window.updateBreadcrumbSubject = updateBreadcrumbSubject;
window.populateBreadcrumbSubjects = populateBreadcrumbSubjects;

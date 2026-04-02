// ============================================================================
// SUBJECTS MANAGER - Modern & Professional
// ============================================================================

let currentSubject = null;
let allSubjects = [];
let currentEditingSubject = null;
let customSvgData = null;
let editCustomSvgData = null;

// Icon library - expanded with more options
const iconLibrary = [
    'fa-brain', 'fa-book', 'fa-laptop-code', 'fa-calculator', 'fa-flask',
    'fa-atom', 'fa-chart-line', 'fa-database', 'fa-code', 'fa-graduation-cap',
    'fa-robot', 'fa-microchip', 'fa-network-wired', 'fa-project-diagram',
    'fa-cube', 'fa-cubes', 'fa-layer-group', 'fa-sitemap', 'fa-cogs',
    'fa-rocket', 'fa-lightbulb', 'fa-palette', 'fa-pen-fancy', 'fa-pen-nib',
    'fa-drafting-compass', 'fa-ruler-combined', 'fa-balance-scale',
    'fa-dna', 'fa-microscope', 'fa-vial', 'fa-pills', 'fa-heartbeat',
    'fa-stethoscope', 'fa-procedures', 'fa-hospital', 'fa-user-md',
    'fa-briefcase', 'fa-file-contract', 'fa-handshake', 'fa-landmark',
    'fa-gavel', 'fa-balance-scale-left', 'fa-book-reader', 'fa-language',
    'fa-globe', 'fa-map', 'fa-compass', 'fa-star', 'fa-sun', 'fa-moon',
    'fa-cloud', 'fa-bolt', 'fa-fire', 'fa-leaf', 'fa-tree', 'fa-feather',
    'fa-music', 'fa-guitar', 'fa-drum', 'fa-theater-masks', 'fa-film',
    'fa-camera', 'fa-paint-brush', 'fa-pencil-ruler', 'fa-shapes',
    'fa-flask-vial', 'fa-atom-simple', 'fa-user-graduate', 'fa-chalkboard-user',
    'fa-dumbbell', 'fa-school', 'fa-book-open', 'fa-book-bookmark', 'fa-books',
    'fa-lightbulb-on', 'fa-microscope-slide', 'fa-telescope', 'fa-function',
    'fa-square-root-variable', 'fa-infinity', 'fa-pi', 'fa-sigma',
    'fa-laptop', 'fa-desktop', 'fa-mobile', 'fa-tablet', 'fa-keyboard',
    'fa-server', 'fa-cloud-arrow-up', 'fa-shield-halved', 'fa-user-lock',
    'fa-trophy', 'fa-medal', 'fa-crown', 'fa-gem', 'fa-certificate',
    'fa-award', 'fa-ribbon', 'fa-badge-check', 'fa-star-shooting'
];

// ============================================================================
// COLOR SELECTION
// ============================================================================

function selectSubjectColor(color, event) {
    event.preventDefault();

    // Remove active class from all color options
    document.querySelectorAll('.color-picker-grid .color-option-box').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active class to selected color
    event.currentTarget.classList.add('active');

    // Update hidden input
    document.getElementById('subject-color').value = color;
}

function selectEditSubjectColor(color, event) {
    event.preventDefault();

    // Remove active class from all color options in edit form
    document.querySelectorAll('#edit-modal .color-picker-grid .color-option-box').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active class to selected color
    event.currentTarget.classList.add('active');

    // Update hidden input
    document.getElementById('edit-subject-color').value = color;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
    initIconPickers();
    initSvgUploads();
    initForms();
    loadSubjects();
});

// ============================================================================
// ICON PICKER
// ============================================================================

function initIconPickers() {
    const iconPicker = document.getElementById('icon-picker');
    const editIconPicker = document.getElementById('edit-icon-picker');

    iconLibrary.forEach(icon => {
        // Create icon for add form
        const iconOption = createIconOption(icon, 'icon-picker');
        iconPicker.appendChild(iconOption);

        // Create icon for edit form
        const editIconOption = createIconOption(icon, 'edit-icon-picker');
        editIconPicker.appendChild(editIconOption);
    });

    // Select default icon
    iconPicker.querySelector('.icon-option').classList.add('selected');
}

function createIconOption(iconClass, pickerId) {
    const div = document.createElement('div');
    div.className = 'icon-option';
    div.innerHTML = `<i class="fas ${iconClass}"></i>`;
    div.onclick = () => selectIcon(iconClass, pickerId);
    return div;
}

function selectIcon(iconClass, pickerId) {
    const picker = document.getElementById(pickerId);
    const options = picker.querySelectorAll('.icon-option');

    options.forEach(opt => opt.classList.remove('selected'));
    event.target.closest('.icon-option').classList.add('selected');

    if (pickerId === 'icon-picker') {
        document.getElementById('selected-icon').value = iconClass;
        // Clear custom SVG if icon is selected
        customSvgData = null;
        document.getElementById('svg-preview').style.display = 'none';
    } else {
        document.getElementById('edit-selected-icon').value = iconClass;
        // Clear custom SVG if icon is selected
        editCustomSvgData = null;
        document.getElementById('edit-svg-preview').style.display = 'none';
    }
}

// ============================================================================
// SVG UPLOAD HANDLING
// ============================================================================

function initSvgUploads() {
    // Add form SVG upload
    initSvgUpload('svg-upload-zone', 'svg-upload', 'svg-preview', false);

    // Edit form SVG upload
    initSvgUpload('edit-svg-upload-zone', 'edit-svg-upload', 'edit-svg-preview', true);
}

function initSvgUpload(zoneId, inputId, previewId, isEdit) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);

    // Click to browse
    zone.onclick = () => input.click();

    // File input change
    input.onchange = (e) => handleSvgFile(e.target.files[0], previewId, isEdit);

    // Drag and drop
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('drag-over');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('drag-over');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && file.type === 'image/svg+xml') {
            handleSvgFile(file, previewId, isEdit);
        }
    });
}

function handleSvgFile(file, previewId, isEdit) {
    if (!file || file.type !== 'image/svg+xml') {
        alert('Please upload a valid SVG file');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const svgContent = e.target.result;

        // Store SVG data
        if (isEdit) {
            editCustomSvgData = svgContent;
        } else {
            customSvgData = svgContent;
        }

        // Show preview
        const preview = document.getElementById(previewId);
        preview.style.display = 'flex';
        preview.innerHTML = `
            ${svgContent}
            <span style="font-size: 14px; color: #34c759; font-weight: 600;">
                <i class="fas fa-check-circle"></i> SVG Loaded
            </span>
            <button type="button" onclick="clearSvg('${previewId}', ${isEdit})"
                    style="background: #ff3b30; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
                Remove
            </button>
        `;

        // Clear icon selection
        const pickerId = isEdit ? 'edit-icon-picker' : 'icon-picker';
        const picker = document.getElementById(pickerId);
        picker.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
    };

    reader.readAsText(file);
}

function clearSvg(previewId, isEdit) {
    document.getElementById(previewId).style.display = 'none';
    document.getElementById(previewId).innerHTML = '';

    if (isEdit) {
        editCustomSvgData = null;
        document.getElementById('edit-svg-upload').value = '';
    } else {
        customSvgData = null;
        document.getElementById('svg-upload').value = '';
    }
}

// ============================================================================
// FORM INITIALIZATION
// ============================================================================

function initForms() {
    // Add subject form
    document.getElementById('add-subject-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await createSubject();
    });

    // Edit subject form
    document.getElementById('edit-subject-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateSubject();
    });
}

// ============================================================================
// LOAD AND DISPLAY SUBJECTS
// ============================================================================

async function loadSubjects() {
    try {
        const response = await fetch('/api/subjects');
        const data = await response.json();

        if (data.success) {
            allSubjects = data.subjects;

            // Load current subject
            const currentResponse = await fetch('/api/current-subject');
            const currentData = await currentResponse.json();

            if (currentData.success && currentData.subject) {
                currentSubject = currentData.subject;
            }

            displaySubjects();
        }
    } catch (error) {
        console.error('Error loading subjects:', error);
        showError('Failed to load subjects');
    }
}

function displaySubjects() {
    const container = document.getElementById('subjects-list');
    container.innerHTML = '';

    if (allSubjects.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>No Subjects Yet</h3>
                <p>Create your first subject using the form above!</p>
            </div>
        `;
        return;
    }

    allSubjects.forEach(subject => {
        const card = createSubjectCard(subject);
        container.appendChild(card);
    });
}

function createSubjectCard(subject) {
    const isActive = currentSubject && subject.id === currentSubject.id;
    const card = document.createElement('div');
    card.className = 'subject-card' + (isActive ? ' active' : '');
    card.style.setProperty('--subject-color', subject.color || '#007AFF');
    card.style.setProperty('--subject-color-light', subject.color + '33' || '#007AFF33');

    const iconHtml = subject.custom_svg
        ? subject.custom_svg
        : `<i class="fas ${subject.icon || 'fa-book'}"></i>`;

    card.innerHTML = `
        <div class="subject-card-header">
            <div class="subject-icon-display" style="background: ${subject.color || '#007AFF'}">
                ${iconHtml}
            </div>
            <div class="subject-info">
                <div class="subject-name-display">
                    ${subject.name}
                    ${isActive ? '<span class="active-badge">Active</span>' : ''}
                </div>
                <div class="subject-meta-display">
                    ${subject.code || 'No code'} ${subject.semester ? '• ' + subject.semester : ''}
                </div>
            </div>
        </div>

        <div class="subject-actions">
            ${!isActive ? `
                <button class="action-btn btn-switch" onclick="switchSubject('${subject.code}')">
                    <i class="fas fa-exchange-alt"></i>
                    Switch
                </button>
            ` : ''}
            <button class="action-btn btn-edit" onclick="editSubject(${subject.id})">
                <i class="fas fa-edit"></i>
                Edit
            </button>
            <button class="action-btn btn-delete" onclick="deleteSubject(${subject.id}, '${subject.name.replace(/'/g, "\\'")}')">
                <i class="fas fa-trash"></i>
                Delete
            </button>
        </div>
    `;

    return card;
}

// ============================================================================
// CREATE SUBJECT
// ============================================================================

async function createSubject() {
    const name = document.getElementById('subject-name').value.trim();
    const code = document.getElementById('subject-code').value.trim();
    const semester = document.getElementById('subject-semester').value.trim();
    const color = document.getElementById('subject-color').value;
    const icon = document.getElementById('selected-icon').value;

    if (!name) {
        alert('Please enter a subject name');
        return;
    }

    const data = {
        name,
        code: code || generateCode(name),
        semester,
        color,
        icon,
        custom_svg: customSvgData
    };

    try {
        const response = await fetch('/api/subjects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            // Reset form
            document.getElementById('add-subject-form').reset();
            customSvgData = null;
            document.getElementById('svg-preview').style.display = 'none';
            document.getElementById('selected-icon').value = 'fa-brain';

            // Reset icon picker
            const iconPicker = document.getElementById('icon-picker');
            iconPicker.querySelectorAll('.icon-option').forEach(opt => opt.classList.remove('selected'));
            iconPicker.querySelector('.icon-option').classList.add('selected');

            // Reload subjects
            await loadSubjects();
            showSuccess('Subject created successfully!');
        } else {
            showError(result.error || 'Failed to create subject');
        }
    } catch (error) {
        console.error('Error creating subject:', error);
        showError('Failed to create subject');
    }
}

function generateCode(name) {
    // Generate a code from the name (e.g., "Machine Intelligence" -> "MACHINE-INT")
    const words = name.trim().split(/\s+/);
    if (words.length === 1) {
        return words[0].substring(0, 10).toUpperCase();
    }
    return words.map(w => w.substring(0, 3)).join('-').toUpperCase();
}

// ============================================================================
// EDIT SUBJECT
// ============================================================================

function editSubject(id) {
    const subject = allSubjects.find(s => s.id === id);
    if (!subject) return;

    currentEditingSubject = subject;

    // Populate form
    document.getElementById('edit-subject-id').value = subject.id;
    document.getElementById('edit-subject-name').value = subject.name;
    document.getElementById('edit-subject-code').value = subject.code || '';
    document.getElementById('edit-subject-semester').value = subject.semester || '';
    document.getElementById('edit-subject-color').value = subject.color || '#007AFF';
    document.getElementById('edit-selected-icon').value = subject.icon || 'fa-book';

    // Select icon in picker
    const editIconPicker = document.getElementById('edit-icon-picker');
    editIconPicker.querySelectorAll('.icon-option').forEach(opt => {
        opt.classList.remove('selected');
        if (opt.querySelector('i').classList.contains(subject.icon)) {
            opt.classList.add('selected');
        }
    });

    // Select color in picker
    document.querySelectorAll('#edit-modal .color-picker-grid .color-option-box').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.color === subject.color) {
            btn.classList.add('active');
        }
    });

    // Handle custom SVG
    if (subject.custom_svg) {
        editCustomSvgData = subject.custom_svg;
        const preview = document.getElementById('edit-svg-preview');
        preview.style.display = 'flex';
        preview.innerHTML = `
            ${subject.custom_svg}
            <span style="font-size: 14px; color: #34c759; font-weight: 600;">
                <i class="fas fa-check-circle"></i> Current SVG
            </span>
            <button type="button" onclick="clearSvg('edit-svg-preview', true)"
                    style="background: #ff3b30; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">
                Remove
            </button>
        `;
    } else {
        editCustomSvgData = null;
        document.getElementById('edit-svg-preview').style.display = 'none';
    }

    // Show modal
    document.getElementById('edit-modal').classList.add('show');
}

async function updateSubject() {
    const id = document.getElementById('edit-subject-id').value;
    const name = document.getElementById('edit-subject-name').value.trim();
    const code = document.getElementById('edit-subject-code').value.trim();
    const semester = document.getElementById('edit-subject-semester').value.trim();
    const color = document.getElementById('edit-subject-color').value;
    const icon = document.getElementById('edit-selected-icon').value;

    if (!name) {
        alert('Please enter a subject name');
        return;
    }

    const data = {
        name,
        code,
        semester,
        color,
        icon,
        custom_svg: editCustomSvgData
    };

    try {
        const response = await fetch(`/api/subjects/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            closeEditModal();
            await loadSubjects();
            showSuccess('Subject updated successfully!');
        } else {
            showError(result.error || 'Failed to update subject');
        }
    } catch (error) {
        console.error('Error updating subject:', error);
        showError('Failed to update subject');
    }
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('show');
    editCustomSvgData = null;
}

// ============================================================================
// DELETE SUBJECT
// ============================================================================

async function deleteSubject(id, name) {
    if (!confirm(`⚠️ Delete "${name}"?\n\nThis will permanently remove:\n• All associated files\n• All history entries\n• The subject folder\n\nThis action cannot be undone!`)) {
        return;
    }

    // Double confirmation for safety
    const confirmation = prompt(`Type "${name}" to confirm deletion:`);
    if (confirmation !== name) {
        alert('Deletion cancelled - name did not match');
        return;
    }

    try {
        const response = await fetch(`/api/subjects/${id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            await loadSubjects();
            showSuccess('Subject deleted successfully');
        } else {
            showError(result.error || 'Failed to delete subject');
        }
    } catch (error) {
        console.error('Error deleting subject:', error);
        showError('Failed to delete subject');
    }
}

// ============================================================================
// SWITCH SUBJECT
// ============================================================================

async function switchSubject(code) {
    try {
        const response = await fetch('/api/set-current-subject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });

        const result = await response.json();

        if (result.success) {
            window.location.href = '/';
        } else {
            showError('Failed to switch subject');
        }
    } catch (error) {
        console.error('Error switching subject:', error);
        showError('Failed to switch subject');
    }
}

// ============================================================================
// UI NOTIFICATIONS
// ============================================================================

function showSuccess(message) {
    showNotification(message, 'success');
}

function showError(message) {
    showNotification(message, 'error');
}

function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#34c759' : '#ff3b30'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
        z-index: 10000;
        font-weight: 600;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 10px;
        animation: slideInRight 0.3s ease;
    `;

    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}"></i>
        <span>${message}</span>
    `;

    document.body.appendChild(notification);

    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

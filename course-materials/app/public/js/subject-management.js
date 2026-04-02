
// ============================================================================
// SUBJECT MANAGEMENT FUNCTIONS
// ============================================================================

let currentSubject = null;
let allSubjects = [];

// Load subjects on page load
async function loadSubjects() {
    try {
        const response = await fetch('/api/subjects');
        const data = await response.json();

        if (data.success) {
            allSubjects = data.subjects;
            updateSubjectDropdown();

            // Load current subject
            const currentResponse = await fetch('/api/current-subject');
            const currentData = await currentResponse.json();

            if (currentData.success && currentData.subject) {
                currentSubject = currentData.subject;
                updateSubjectDisplay();
            }
        }
    } catch (error) {
        console.error('Error loading subjects:', error);
    }
}

// Update subject display in toolbar
function updateSubjectDisplay() {
    if (!currentSubject) return;

    const nameElement = document.getElementById('subject-name');
    const semesterElement = document.getElementById('subject-semester');
    const iconElement = document.getElementById('subject-icon');
    const iconWrapper = document.getElementById('subject-icon-wrapper');

    if (nameElement) nameElement.textContent = currentSubject.name;
    if (semesterElement) semesterElement.textContent = currentSubject.semester || '';

    if (iconElement && iconWrapper) {
        // Check if it's a custom SVG
        if (currentSubject.custom_svg) {
            iconWrapper.innerHTML = currentSubject.custom_svg;
        } else {
            iconElement.className = `fas ${currentSubject.icon || 'fa-book'}`;
        }
        iconWrapper.style.background = currentSubject.color || '#007AFF';
    }
}

// Update subject dropdown menu
function updateSubjectDropdown() {
    const menu = document.getElementById('subject-dropdown-menu');
    if (!menu) return;

    menu.innerHTML = '';

    allSubjects.forEach(subject => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'dropdown-item';
        if (currentSubject && subject.id === currentSubject.id) {
            link.classList.add('active');
        }

        const iconHtml = subject.custom_svg
            ? `<div class="subject-item-icon" style="background: ${subject.color}">${subject.custom_svg}</div>`
            : `<div class="subject-item-icon" style="background: ${subject.color}"><i class="fas ${subject.icon}"></i></div>`;

        link.innerHTML = `
            ${iconHtml}
            <div class="subject-item-info">
                <span class="subject-item-name">${subject.name}</span>
                <span class="subject-item-semester">${subject.semester || ''}</span>
            </div>
        `;

        link.onclick = (e) => {
            e.preventDefault();
            switchSubject(subject.code);
        };
        item.appendChild(link);
        menu.appendChild(item);
    });

    // Add divider
    const divider = document.createElement('li');
    divider.innerHTML = '<hr class="dropdown-divider">';
    menu.appendChild(divider);

    // Add manage subjects option
    const manageItem = document.createElement('li');
    const manageLink = document.createElement('a');
    manageLink.className = 'dropdown-item manage-subjects-item';
    manageLink.innerHTML = '<i class="fas fa-cog me-2"></i> Manage Subjects...';
    manageLink.onclick = (e) => {
        e.preventDefault();
        window.location.href = '/subjects.html';
    };
    manageItem.appendChild(manageLink);
    menu.appendChild(manageItem);
}

// Switch to a different subject
async function switchSubject(subjectCode) {
    try {
        const response = await fetch('/api/set-current-subject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: subjectCode })
        });

        const data = await response.json();

        if (data.success) {
            window.location.reload();
        }
    } catch (error) {
        console.error('Error switching subject:', error);
        alert('Failed to switch subject');
    }
}

// Open subject manager modal
function openSubjectManager() {
    const modal = new bootstrap.Modal(document.getElementById('subjectManagerModal'));
    modal.show();
    loadSubjectsForManager();
}

// Load subjects in the manager
async function loadSubjectsForManager() {
    try {
        const response = await fetch('/api/subjects');
        const data = await response.json();

        if (data.success) {
            displaySubjectsInManager(data.subjects);
        }
    } catch (error) {
        console.error('Error loading subjects for manager:', error);
    }
}

// Display subjects in manager modal
function displaySubjectsInManager(subjects) {
    const container = document.getElementById('subjects-list');
    container.innerHTML = '';

    if (subjects.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">No subjects yet. Add one above!</p>';
        return;
    }

    subjects.forEach(subject => {
        const card = document.createElement('div');
        card.className = 'subject-card';
        if (currentSubject && subject.id === currentSubject.id) {
            card.classList.add('current-subject');
        }

        card.innerHTML = `
            <div class="subject-card-header">
                <div class="subject-card-icon" style="background: ${subject.color}">
                    <i class="fas ${subject.icon}"></i>
                </div>
                <div class="subject-card-title">
                    <h6>${subject.name}</h6>
                    <p>${subject.code || ''} ${subject.semester ? '• ' + subject.semester : ''}</p>
                </div>
            </div>
            <div class="subject-card-actions">
                <button class="btn btn-sm btn-outline-primary" onclick="switchSubject('${subject.code}')">
                    <i class="fas fa-exchange-alt"></i> Switch
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteSubject(${subject.id}, '${subject.name}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;

        container.appendChild(card);
    });
}

// Delete subject
async function deleteSubject(subjectId, subjectName) {
    if (!confirm(`Are you sure you want to delete "${subjectName}"? This will delete all associated files and history.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/subjects/${subjectId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            await loadSubjects();
            await loadSubjectsForManager();
            alert('Subject deleted successfully');
        } else {
            alert('Error deleting subject: ' + data.error);
        }
    } catch (error) {
        console.error('Error deleting subject:', error);
        alert('Failed to delete subject');
    }
}

// Open file upload modal
function openFileUpload() {
    const modal = new bootstrap.Modal(document.getElementById('fileUploadModal'));
    modal.show();
    loadSubjectsForUpload();
}

// Load subjects for upload form
async function loadSubjectsForUpload() {
    try {
        const response = await fetch('/api/subjects');
        const data = await response.json();

        if (data.success) {
            const select = document.getElementById('upload-subject');
            select.innerHTML = '';

            data.subjects.forEach(subject => {
                const option = document.createElement('option');
                option.value = subject.id;
                option.textContent = `${subject.name} ${subject.semester ? '(' + subject.semester + ')' : ''}`;
                if (currentSubject && subject.id === currentSubject.id) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading subjects for upload:', error);
    }
}

// Initialize subject management
function initSubjectManagement() {
    const addSubjectForm = document.getElementById('add-subject-form');
    if (addSubjectForm) {
        addSubjectForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const name = document.getElementById('new-subject-name').value;
            const code = document.getElementById('new-subject-code').value;
            const semester = document.getElementById('new-subject-semester').value;
            const color = document.getElementById('new-subject-color').value;
            const icon = document.getElementById('new-subject-icon').value;

            try {
                const response = await fetch('/api/subjects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, code, semester, color, icon })
                });

                const data = await response.json();

                if (data.success) {
                    addSubjectForm.reset();
                    await loadSubjects();
                    await loadSubjectsForManager();
                    alert('Subject added successfully!');
                } else {
                    alert('Error adding subject: ' + data.error);
                }
            } catch (error) {
                console.error('Error adding subject:', error);
                alert('Failed to add subject');
            }
        });
    }

    loadSubjects();
}

// Initialize file upload
function initFileUpload() {
    const uploadForm = document.getElementById('upload-pdf-form');
    if (uploadForm) {
        uploadForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const formData = new FormData();
            formData.append('subject_id', document.getElementById('upload-subject').value);
            formData.append('category', document.getElementById('upload-category').value);
            formData.append('lecture_number', document.getElementById('upload-lecture-number').value);
            formData.append('pdf', document.getElementById('upload-pdf-file').files[0]);
            formData.append('custom_name', document.getElementById('upload-custom-name').value);

            const progressBar = document.getElementById('upload-progress-bar');
            const progressContainer = document.getElementById('upload-progress');

            progressContainer.style.display = 'block';
            progressBar.style.width = '0%';

            try {
                const xhr = new XMLHttpRequest();

                xhr.upload.addEventListener('progress', function(e) {
                    if (e.lengthComputable) {
                        const percentComplete = (e.loaded / e.total) * 100;
                        progressBar.style.width = percentComplete + '%';
                    }
                });

                xhr.addEventListener('load', function() {
                    if (xhr.status === 200) {
                        const data = JSON.parse(xhr.responseText);
                        if (data.success) {
                            alert('File uploaded successfully!');
                            uploadForm.reset();
                            progressContainer.style.display = 'none';
                            bootstrap.Modal.getInstance(document.getElementById('fileUploadModal')).hide();
                            location.reload();
                        } else {
                            alert('Upload failed: ' + data.error);
                            progressContainer.style.display = 'none';
                        }
                    } else {
                        alert('Upload failed: Server error');
                        progressContainer.style.display = 'none';
                    }
                });

                xhr.addEventListener('error', function() {
                    alert('Upload failed: Network error');
                    progressContainer.style.display = 'none';
                });

                xhr.open('POST', '/api/upload-pdf');
                xhr.send(formData);

            } catch (error) {
                console.error('Error uploading file:', error);
                alert('Failed to upload file');
                progressContainer.style.display = 'none';
            }
        });
    }
}

// Initialize on DOM load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        initSubjectManagement();
        initFileUpload();
    });
} else {
    initSubjectManagement();
    initFileUpload();
}

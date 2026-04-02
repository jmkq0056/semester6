import React, { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useNavigate } from 'react-router-dom';
import * as api from '../../services/api';

const Upload = () => {
  const { currentSubject, refreshFiles } = useApp();
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('notes');
  const [lectureNumber, setLectureNumber] = useState('');
  const [customFilename, setCustomFilename] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('category', category);
    formData.append('subjectCode', currentSubject.code);
    if (lectureNumber) formData.append('lectureNumber', lectureNumber);
    if (customFilename) formData.append('customFilename', customFilename);

    try {
      setUploading(true);
      await api.uploadPDF(formData, (prog) => setProgress(prog));
      alert('Upload successful!');
      await refreshFiles();
      navigate('/');
    } catch (error) {
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2><i className="fas fa-upload me-2"></i>Upload PDF</h2>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
          <i className="fas fa-arrow-left me-1"></i>Back
        </button>
      </div>

      <div className="card">
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <label className="form-label">Subject</label>
              <input type="text" className="form-control" value={currentSubject?.name} disabled />
            </div>

            <div className="mb-3">
              <label className="form-label">Category</label>
              <select
                className="form-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                <option value="notes">Lecture Notes</option>
                <option value="slides">Lecture Slides</option>
                <option value="exercises">Exercises</option>
                <option value="exercises-no-solutions">Ex (No Sol)</option>
                <option value="blueprint">Blueprint</option>
                <option value="teachers-method">Teachers Method</option>
              </select>
            </div>

            <div className="mb-3">
              <label className="form-label">Lecture Number (optional)</label>
              <input
                type="number"
                className="form-control"
                min="1"
                max="99"
                value={lectureNumber}
                onChange={(e) => setLectureNumber(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label">Custom Filename (optional)</label>
              <input
                type="text"
                className="form-control"
                value={customFilename}
                onChange={(e) => setCustomFilename(e.target.value)}
              />
            </div>

            <div className="mb-3">
              <label className="form-label">PDF File</label>
              <input
                type="file"
                className="form-control"
                accept=".pdf"
                onChange={(e) => setFile(e.target.files[0])}
                required
              />
            </div>

            {uploading && (
              <div className="mb-3">
                <div className="progress">
                  <div
                    className="progress-bar"
                    role="progressbar"
                    style={{ width: progress + '%' }}
                  >
                    {progress}%
                  </div>
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary" disabled={uploading}>
              {uploading ? 'Uploading...' : 'Upload PDF'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Upload;

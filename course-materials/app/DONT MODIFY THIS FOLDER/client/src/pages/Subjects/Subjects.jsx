import React, { useState } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useNavigate } from 'react-router-dom';
import * as api from '../../services/api';

const Subjects = () => {
  const { subjects, currentSubject, switchSubject } = useApp();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    semester: '',
    color: '#007AFF',
    icon: 'fa-book'
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.createSubject(formData);
      window.location.reload();
    } catch (error) {
      alert('Error creating subject: ' + error.message);
    }
  };

  const handleSwitch = async (code) => {
    try {
      await switchSubject(code);
      navigate('/');
    } catch (error) {
      alert('Error switching subject: ' + error.message);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2><i className="fas fa-graduation-cap me-2"></i>Subjects</h2>
        <div>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            <i className="fas fa-plus me-1"></i>Add Subject
          </button>
          <button className="btn btn-secondary ms-2" onClick={() => navigate('/')}>
            <i className="fas fa-arrow-left me-1"></i>Back
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card mb-4">
          <div className="card-body">
            <h5>Add New Subject</h5>
            <form onSubmit={handleSubmit}>
              <div className="row">
                <div className="col-md-4">
                  <label className="form-label">Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Code</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Semester</label>
                  <input
                    type="text"
                    className="form-control"
                    value={formData.semester}
                    onChange={(e) => setFormData({ ...formData, semester: e.target.value })}
                  />
                </div>
              </div>
              <div className="row mt-3">
                <div className="col-md-6">
                  <label className="form-label">Color</label>
                  <input
                    type="color"
                    className="form-control"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Icon</label>
                  <select
                    className="form-select"
                    value={formData.icon}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  >
                    <option value="fa-book">Book</option>
                    <option value="fa-brain">Brain</option>
                    <option value="fa-code">Code</option>
                    <option value="fa-laptop">Laptop</option>
                    <option value="fa-graduation-cap">Graduation Cap</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="btn btn-success mt-3">Create Subject</button>
            </form>
          </div>
        </div>
      )}

      <div className="row">
        {subjects.map((subject) => (
          <div key={subject.id} className="col-md-4 mb-3">
            <div className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <i className={'fas ' + subject.icon + ' fa-2x mb-2'} style={{ color: subject.color }}></i>
                    <h5>{subject.name}</h5>
                    <p className="text-muted">{subject.semester}</p>
                    {subject.code === currentSubject?.code && (
                      <span className="badge bg-success">Active</span>
                    )}
                  </div>
                  <div>
                    {subject.code !== currentSubject?.code && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleSwitch(subject.code)}
                      >
                        Switch
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Subjects;

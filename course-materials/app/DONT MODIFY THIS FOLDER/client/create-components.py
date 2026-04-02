#!/usr/bin/env python3
import os

components = {
    'src/components/Navbar/Navbar.jsx': '''import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../contexts/AppContext';

const Navbar = ({ searchTerm, onSearchChange, currentView, onViewChange }) => {
  const { currentSubject } = useApp();
  if (!currentSubject) return null;

  return (
    <nav className="navbar navbar-expand-lg toolbar">
      <div className="container-fluid">
        <div className="d-flex align-items-center gap-3">
          <span className="navbar-brand mb-0 h1 toolbar-title">
            <i className={'fas ' + currentSubject.icon + ' text-primary me-2'}></i>
            <span className="fw-bold">{currentSubject.name}</span>
            <span className="badge bg-gradient bg-primary ms-2">{currentSubject.semester}</span>
          </span>
          <Link to="/subjects" className="btn btn-sm btn-outline-primary">
            <i className="fas fa-cog me-1"></i>Subjects
          </Link>
          <Link to="/upload" className="btn btn-sm btn-success">
            <i className="fas fa-upload me-1"></i>Upload
          </Link>
          <Link to="/history" className="btn btn-sm btn-info">
            <i className="fas fa-history me-1"></i>History
          </Link>
        </div>
        <div className="d-flex align-items-center gap-3 flex-grow-1 justify-content-end">
          <div className="search-bar-container">
            <span className="search-icon"><i className="fas fa-search"></i></span>
            <input
              type="text"
              className="form-control search-bar shadow-sm"
              placeholder="Search PDFs..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="btn-group view-options shadow-sm" role="group">
            {['all', 'notes', 'slides', 'exercises'].map(view => (
              <button
                key={view}
                type="button"
                className={'btn btn-sm ' + (currentView === view ? 'btn-primary' : 'btn-outline-primary') + ' view-btn'}
                onClick={() => onViewChange(view)}
              >
                {view.charAt(0).toUpperCase() + view.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
''',

    'src/components/Navbar/Navbar.css': '/* Styles in main styles.css */',
}

for filepath, content in components.items():
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'Created: {filepath}')

print('\nComponents created successfully!')

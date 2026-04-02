import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { getLectureColor } from '../../utils/helpers';
import './FileList.css';

const FileList = ({ files = [], onFileClick, onFileManage }) => {
  const [expandedPaths, setExpandedPaths] = useState(new Set());

  const togglePathExpand = (e, path) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedPaths(newExpanded);
  };

  const getShortPath = (path) => {
    const pathParts = path.split('/');
    return pathParts.length > 2 ? `.../${pathParts[pathParts.length - 1]}` : path;
  };

  const renderFileRow = (file, index) => {
    const lectureNum = file.lecture;
    const isExpanded = expandedPaths.has(file.path);
    const displayPath = isExpanded ? file.path : getShortPath(file.path);

    return (
      <tr
        key={`${file.path}-${index}`}
        data-index={index}
        data-file-type={file.fileType || file.category}
        data-lecture={lectureNum || ''}
        data-lecture-id={lectureNum ? `lecture-${lectureNum}` : ''}
        data-is-custom-category={file.isCustomCategory || false}
        data-search-text={`${file.name} ${file.category} ${file.path}`.toLowerCase()}
        onClick={() => onFileClick && onFileClick(file)}
        style={{ cursor: 'pointer' }}
      >
        <td>
          <div className="file-name">
            <span className="file-icon pdf">
              <i className="fas fa-file-pdf"></i>
            </span>
            <span>{file.name}</span>
            {lectureNum && (
              <span
                className={`badge lecture-${lectureNum}`}
                style={{
                  fontSize: '8px',
                  padding: '2px 4px',
                  marginLeft: '4px',
                  backgroundColor: getLectureColor(lectureNum),
                  color: '#fff',
                }}
              >
                L{lectureNum}
              </span>
            )}
          </div>
        </td>
        <td>{file.category}</td>
        <td>
          <span className="file-type">PDF</span>
        </td>
        <td>
          <span
            className={`file-path ${isExpanded ? 'expanded' : 'compact-path'}`}
            title={file.path}
            data-full-path={file.path}
          >
            {displayPath}
            <i
              className={`fas ${
                isExpanded ? 'fa-folder-open' : 'fa-folder'
              } path-expand-icon`}
              onClick={(e) => togglePathExpand(e, file.path)}
            ></i>
          </span>
        </td>
        <td>
          <button
            className="btn btn-sm"
            onClick={(e) => {
              e.stopPropagation();
              onFileManage && onFileManage(file);
            }}
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              border: '1px solid #d1d1d6',
              background: 'white',
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title="Manage file"
          >
            <i className="fas fa-cog"></i>
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div className="file-list-container">
      <table className="file-list">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Type</th>
            <th>Path</th>
            <th style={{ width: '100px' }}>Actions</th>
          </tr>
        </thead>
        <tbody id="file-list-body">
          {files.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#8e8e93' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                  <i className="fas fa-folder-open"></i>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>
                  No files found
                </div>
                <div style={{ fontSize: '13px' }}>
                  Try adjusting your search or filter criteria
                </div>
              </td>
            </tr>
          ) : (
            files.map((file, index) => renderFileRow(file, index))
          )}
        </tbody>
      </table>
    </div>
  );
};

FileList.propTypes = {
  files: PropTypes.array,
  onFileClick: PropTypes.func,
  onFileManage: PropTypes.func,
};

export default FileList;

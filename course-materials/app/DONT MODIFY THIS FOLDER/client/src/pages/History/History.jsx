import React, { useEffect } from 'react';
import { useApp } from '../../contexts/AppContext';
import { useNavigate } from 'react-router-dom';
import { timeAgo, getCategoryDisplayName } from '../../utils/helpers';

const History = () => {
  const { history, refreshHistory } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    refreshHistory();
  }, []);

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2><i className="fas fa-history me-2"></i>History</h2>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
          <i className="fas fa-arrow-left me-1"></i>Back
        </button>
      </div>

      <div className="row">
        {history.length === 0 ? (
          <div className="col-12 text-center text-muted py-5">
            <i className="fas fa-folder-open fa-3x mb-3"></i>
            <div>No history yet</div>
          </div>
        ) : (
          history.map((item, index) => (
            <div key={index} className="col-md-4 mb-3">
              <div className="card">
                <div className="card-body">
                  <h6 className="card-title">{item.title}</h6>
                  <p className="text-muted small">{item.path}</p>
                  <div className="d-flex justify-content-between align-items-center">
                    <span className="badge bg-secondary">{getCategoryDisplayName(item.category)}</span>
                    <span className="text-muted small">{timeAgo(item.timestamp)}</span>
                  </div>
                  {item.wasSplitView && (
                    <div className="mt-2">
                      <span className="badge bg-info">
                        <i className="fas fa-columns me-1"></i>Split View
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default History;

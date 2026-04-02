import React, { useState, useEffect, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import './PDFViewer.css';

const PDFViewer = ({
  isOpen = false,
  leftPDF = null,
  rightPDF = null,
  isSplitView = false,
  onClose,
  onToggleSplit,
  onToggleReplace,
  onSelectPDFForSplit,
  onReplacePDF,
  pdfStructure = {},
  splitRatio = 50,
  onSplitRatioChange,
}) => {
  const [showSelector, setShowSelector] = useState(false);
  const [selectorMode, setSelectorMode] = useState('split'); // 'split' or 'replace'
  const [selectorSearch, setSelectorSearch] = useState('');
  const [leftPaneHidden, setLeftPaneHidden] = useState(false);
  const [rightPaneHidden, setRightPaneHidden] = useState(false);
  const [lastFocusedPane, setLastFocusedPane] = useState('left');
  const [showResizeControls, setShowResizeControls] = useState(false);

  const leftViewerRef = useRef(null);
  const rightViewerRef = useRef(null);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showSelector) {
          setShowSelector(false);
        } else if (isOpen) {
          onClose && onClose();
        }
      }

      // Handle Ctrl+F / Cmd+F for search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && isOpen) {
        const iframe = lastFocusedPane === 'left' ? leftViewerRef.current : rightViewerRef.current;
        if (iframe) {
          setTimeout(() => {
            try {
              iframe.focus();
              iframe.contentWindow?.focus();
            } catch (err) {
              console.log('Could not focus iframe');
            }
          }, 10);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showSelector, onClose, lastFocusedPane]);

  // Close modal on background click
  const handleBackgroundClick = (e) => {
    if (e.target.id === 'pdf-modal') {
      onClose && onClose();
    }
  };

  // Toggle split view
  const handleToggleSplit = () => {
    if (showSelector && selectorMode === 'split') {
      setShowSelector(false);
    } else {
      setSelectorMode('split');
      setShowSelector(true);
    }
  };

  // Toggle replace PDF
  const handleToggleReplace = () => {
    if (showSelector && selectorMode === 'replace') {
      setShowSelector(false);
    } else {
      setSelectorMode('replace');
      setShowSelector(true);
    }
  };

  // Select PDF (split or replace based on mode)
  const handleSelectPDF = (pdf) => {
    if (selectorMode === 'replace') {
      onReplacePDF && onReplacePDF(pdf);
    } else {
      onSelectPDFForSplit && onSelectPDFForSplit(pdf);
    }
    setShowSelector(false);
  };

  // Hide/show panes
  const hideLeftPane = () => {
    setLeftPaneHidden(true);
  };

  const hideRightPane = () => {
    setRightPaneHidden(true);
  };

  const showLeftPane = () => {
    setLeftPaneHidden(false);
  };

  const showRightPane = () => {
    setRightPaneHidden(false);
  };

  // Duplicate current PDF
  const duplicateCurrentPDF = () => {
    if (leftPDF) {
      handleSelectPDF(leftPDF);
    }
  };

  // Set split ratio
  const setSplitRatioValue = (ratio) => {
    onSplitRatioChange && onSplitRatioChange(ratio);
  };

  // Trigger browser find
  const triggerBrowserFind = (pane) => {
    const iframe = pane === 'left' ? leftViewerRef.current : rightViewerRef.current;
    if (iframe) {
      try {
        iframe.focus();
        iframe.contentWindow?.focus();
        setLastFocusedPane(pane);
      } catch (e) {
        console.log('Could not focus iframe');
      }
    }

    // Show search instruction
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcut = isMac ? 'Cmd+F' : 'Ctrl+F';
    alert(`Press ${shortcut} to search in this PDF. Make sure the PDF is focused (click on it first).`);
  };

  // Render PDF selector
  const renderPDFSelector = () => {
    const allPDFs = [];

    // Add notes
    if (pdfStructure.notes) {
      Object.entries(pdfStructure.notes).forEach(([lectureName, pdfs]) => {
        allPDFs.push({
          groupTitle: lectureName,
          pdfs: pdfs || [],
        });
      });
    }

    // Add other categories
    const categories = [
      { key: 'slides', title: 'Lecture Slides' },
      { key: 'exercises', title: 'Exercises' },
      { key: 'exercisesNoSolutions', title: 'Exercises (No Solutions)' },
      { key: 'blueprint', title: 'Blueprint' },
      { key: 'teachersMethod', title: 'Teachers Method' },
    ];

    categories.forEach(({ key, title }) => {
      if (pdfStructure[key] && pdfStructure[key].length > 0) {
        allPDFs.push({
          groupTitle: title,
          pdfs: pdfStructure[key],
        });
      }
    });

    // Add custom categories
    if (pdfStructure.customCategories) {
      Object.entries(pdfStructure.customCategories).forEach(([categoryName, pdfs]) => {
        if (pdfs && pdfs.length > 0) {
          allPDFs.push({
            groupTitle: categoryName
              .split('-')
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' '),
            pdfs,
          });
        }
      });
    }

    // Filter PDFs based on search
    const filteredGroups = allPDFs
      .map((group) => ({
        ...group,
        pdfs: group.pdfs.filter(
          (pdf) =>
            pdf.title?.toLowerCase().includes(selectorSearch.toLowerCase()) ||
            pdf.path?.toLowerCase().includes(selectorSearch.toLowerCase())
        ),
      }))
      .filter((group) => group.pdfs.length > 0);

    return (
      <div className={`pdf-selector ${showSelector ? 'visible' : ''}`} id="pdf-selector">
        <div className="selector-header">
          <h3>{selectorMode === 'replace' ? 'Replace Current PDF' : 'Select PDF for Split View'}</h3>
          <div className="selector-search-container">
            <div className="search-wrapper">
              <span className="search-icon-small">
                <i className="fas fa-search"></i>
              </span>
              <input
                type="text"
                className="selector-search"
                placeholder="Search PDFs..."
                value={selectorSearch}
                onChange={(e) => setSelectorSearch(e.target.value)}
              />
            </div>
            {selectorMode === 'split' && (
              <button
                className="header-icon-btn"
                onClick={duplicateCurrentPDF}
                title="Duplicate Current PDF"
              >
                <i className="fas fa-clone"></i>
              </button>
            )}
          </div>
        </div>

        <div className="selector-divider"></div>

        {/* Fast Search Placeholder */}
        <div className="selector-fast-search">
          <button className="fast-search-sidebar-btn">
            <i className="fas fa-bolt"></i>
            <span> Fast Search</span>
          </button>
          <p className="fast-search-hint">Quick search across all PDFs</p>
        </div>

        <div className="selector-divider"></div>

        {/* Split Resize Controls */}
        {selectorMode === 'split' && isSplitView && (
          <>
            <div className="split-resize-controls" id="split-resize-controls">
              <div
                className="resize-controls-header"
                onClick={() => setShowResizeControls(!showResizeControls)}
              >
                <span>Adjust Split Ratio</span>
                <span className="resize-toggle-icon">{showResizeControls ? '▲' : '▼'}</span>
              </div>
              {showResizeControls && (
                <div className="resize-buttons-container">
                  <div className="resize-buttons">
                    <button className="resize-btn" onClick={() => setSplitRatioValue(25)}>
                      25% | 75%
                    </button>
                    <button className="resize-btn" onClick={() => setSplitRatioValue(33)}>
                      33% | 67%
                    </button>
                    <button className="resize-btn" onClick={() => setSplitRatioValue(50)}>
                      50% | 50%
                    </button>
                    <button className="resize-btn" onClick={() => setSplitRatioValue(67)}>
                      67% | 33%
                    </button>
                    <button className="resize-btn" onClick={() => setSplitRatioValue(75)}>
                      75% | 25%
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="selector-divider"></div>
          </>
        )}

        <div className="selector-content">
          {filteredGroups.map((group, index) => (
            <div key={index} className="selector-group">
              <div className="selector-group-title">{group.groupTitle}</div>
              {group.pdfs.map((pdf, pdfIndex) => (
                <div
                  key={pdfIndex}
                  className="selector-item"
                  onClick={() => handleSelectPDF(pdf)}
                >
                  <div className="selector-item-title">{pdf.title}</div>
                  <div className="selector-item-path">{pdf.path}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div id="pdf-modal" className="modal" style={{ display: 'block' }} onClick={handleBackgroundClick}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-section">
            <div className="modal-title" id="modal-title">
              {leftPDF?.title || 'No PDF Selected'}
            </div>
            <div className="modal-subtitle" id="modal-subtitle">
              {leftPDF?.category || ''}
            </div>
          </div>
          <div className="modal-controls">
            <button
              className={`control-btn ${selectorMode === 'replace' && showSelector ? 'active' : ''}`}
              onClick={handleToggleReplace}
            >
              <span>
                <i className="fas fa-sync-alt"></i>
              </span>
              <span>Replace PDF</span>
            </button>
            <button
              className={`control-btn ${selectorMode === 'split' && showSelector ? 'active' : ''}`}
              onClick={handleToggleSplit}
            >
              <span>
                <i className="fas fa-columns"></i>
              </span>
              <span>Split View</span>
            </button>
            {leftPaneHidden && (
              <button className="control-btn" onClick={showLeftPane}>
                <span>
                  <i className="fas fa-arrow-left"></i>
                </span>
                <span>Show Left</span>
              </button>
            )}
            {rightPaneHidden && isSplitView && (
              <button className="control-btn" onClick={showRightPane}>
                <span>
                  <i className="fas fa-arrow-right"></i>
                </span>
                <span>Show Right</span>
              </button>
            )}
            <button className="close-btn" onClick={onClose}>
              <i className="fas fa-times"></i> Close
            </button>
          </div>
        </div>

        <div className="viewer-container">
          {/* Left/Primary Viewer Pane */}
          <div
            className={`viewer-pane ${isSplitView ? 'split' : ''}`}
            id="pane-left"
            style={{
              display: leftPaneHidden ? 'none' : 'flex',
              flex: isSplitView ? `0 0 ${splitRatio}%` : '1',
            }}
          >
            {isSplitView && (
              <div className="pane-header" style={{ display: 'flex' }}>
                <span className="pane-title">{leftPDF?.title || ''}</span>
                <div className="pane-search-container">
                  <button
                    className="pane-search-btn"
                    onClick={() => triggerBrowserFind('left')}
                    title="Search this PDF (Ctrl+F / Cmd+F)"
                  >
                    <i className="fas fa-search"></i> Find
                  </button>
                  <span className="pane-search-hint">Click or press Ctrl+F</span>
                </div>
                <div className="pane-controls">
                  <button className="pane-close" onClick={hideLeftPane}>
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              </div>
            )}
            <iframe
              ref={leftViewerRef}
              id="pdf-viewer-left"
              className="pdf-viewer"
              src={leftPDF?.path || ''}
              onClick={() => setLastFocusedPane('left')}
            ></iframe>
          </div>

          {/* Divider */}
          {isSplitView && !leftPaneHidden && !rightPaneHidden && (
            <div className="divider" id="divider"></div>
          )}

          {/* Right Viewer Pane */}
          {isSplitView && (
            <div
              className={`viewer-pane split`}
              id="pane-right"
              style={{
                display: rightPaneHidden ? 'none' : 'flex',
                flex: `0 0 ${100 - splitRatio}%`,
              }}
            >
              <div className="pane-header" style={{ display: 'flex' }}>
                <span className="pane-title">{rightPDF?.title || ''}</span>
                <div className="pane-search-container">
                  <button
                    className="pane-search-btn"
                    onClick={() => triggerBrowserFind('right')}
                    title="Search this PDF (Ctrl+F / Cmd+F)"
                  >
                    <i className="fas fa-search"></i> Find
                  </button>
                  <span className="pane-search-hint">Click or press Ctrl+F</span>
                </div>
                <div className="pane-controls">
                  <button className="pane-close" onClick={hideRightPane}>
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              </div>
              <iframe
                ref={rightViewerRef}
                id="pdf-viewer-right"
                className="pdf-viewer"
                src={rightPDF?.path || ''}
                onClick={() => setLastFocusedPane('right')}
              ></iframe>
            </div>
          )}

          {/* PDF Selector Sidebar */}
          {renderPDFSelector()}
        </div>
      </div>
    </div>
  );
};

PDFViewer.propTypes = {
  isOpen: PropTypes.bool,
  leftPDF: PropTypes.object,
  rightPDF: PropTypes.object,
  isSplitView: PropTypes.bool,
  onClose: PropTypes.func,
  onToggleSplit: PropTypes.func,
  onToggleReplace: PropTypes.func,
  onSelectPDFForSplit: PropTypes.func,
  onReplacePDF: PropTypes.func,
  pdfStructure: PropTypes.object,
  splitRatio: PropTypes.number,
  onSplitRatioChange: PropTypes.func,
};

export default PDFViewer;

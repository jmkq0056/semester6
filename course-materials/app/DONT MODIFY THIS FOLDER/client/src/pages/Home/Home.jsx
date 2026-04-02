import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  IconButton,
  Breadcrumbs,
  Link as MuiLink,
  Stack,
  Tooltip,
} from '@mui/material';
import {
  Visibility,
  Link as LinkIcon,
  FolderOpen,
  NavigateNext,
} from '@mui/icons-material';
import { useApp } from '../../contexts/AppContext';
import Navbar from '../../components/Navbar/Navbar';
import Sidebar from '../../components/Sidebar/Sidebar';
import { buildFlatFileList, filterFiles, getCategoryDisplayName, getLectureColor } from '../../utils/helpers';

const Home = () => {
  const { pdfStructure, currentSubject, loading } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [currentView, setCurrentView] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [lectureFilter, setLectureFilter] = useState(null);

  const flatFiles = buildFlatFileList(pdfStructure);
  const filteredFiles = filterFiles(flatFiles, searchTerm, categoryFilter !== 'all' ? categoryFilter : null, lectureFilter);

  const handleFilterByCategory = (category) => {
    setCategoryFilter(category);
    setLectureFilter(null);
    setCurrentView(category);
  };

  const handleFilterByLecture = (lecture) => {
    setLectureFilter(lecture);
    setCategoryFilter('notes');
    setCurrentView('notes');
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography variant="h6" color="white" fontWeight={600}>
          Loading your course materials...
        </Typography>
      </Box>
    );
  }

  const currentLocation = lectureFilter 
    ? 'Lecture ' + lectureFilter.replace(/\D/g, '') 
    : categoryFilter === 'all' ? 'All Files' : getCategoryDisplayName(categoryFilter);

  return (
    <>
      <Navbar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        currentView={currentView}
        onViewChange={(view) => {
          setCurrentView(view);
          setCategoryFilter(view);
          setLectureFilter(null);
        }}
      />

      <Paper
        elevation={0}
        sx={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          backdropFilter: 'blur(10px)',
          borderRadius: 3,
          p: 1.5,
          mb: 2,
        }}
      >
        <Breadcrumbs separator={<NavigateNext fontSize="small" />}>
          <Typography color="text.secondary">
            📁 Semester 5
          </Typography>
          <Typography color="text.secondary">
            {currentSubject?.name || 'machine intelligence'}
          </Typography>
          <Typography color="primary" fontWeight={600}>
            {currentLocation}
          </Typography>
        </Breadcrumbs>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 2 }}>
        <Sidebar
          onFilterByCategory={handleFilterByCategory}
          onFilterByLecture={handleFilterByLecture}
          activeCategory={categoryFilter}
        />

        <Paper
          elevation={0}
          sx={{
            backgroundColor: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(10px)',
            borderRadius: 3,
            p: 3,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
            <Stack direction="row" spacing={1} alignItems="center">
              <FolderOpen color="primary" />
              <Typography variant="h6" fontWeight={700}>
                {filteredFiles.length} {filteredFiles.length === 1 ? 'Document' : 'Documents'}
              </Typography>
            </Stack>
            {searchTerm && (
              <Typography variant="body2" color="text.secondary">
                Searching for: <strong style={{ color: '#667eea' }}>{searchTerm}</strong>
              </Typography>
            )}
          </Stack>

          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell width="40%">
                    <Typography variant="body2" fontWeight={700}>Name</Typography>
                  </TableCell>
                  <TableCell width="20%">
                    <Typography variant="body2" fontWeight={700}>Category</Typography>
                  </TableCell>
                  <TableCell width="10%">
                    <Typography variant="body2" fontWeight={700}>Lecture</Typography>
                  </TableCell>
                  <TableCell width="20%">
                    <Typography variant="body2" fontWeight={700}>Path</Typography>
                  </TableCell>
                  <TableCell width="10%" align="center">
                    <Typography variant="body2" fontWeight={700}>Actions</Typography>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredFiles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 8 }}>
                      <FolderOpen sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                      <Typography variant="h6" color="text.secondary" gutterBottom>
                        No documents found
                      </Typography>
                      <Typography variant="body2" color="text.disabled">
                        {searchTerm ? 'No results for "' + searchTerm + '"' : 'Try selecting a different category'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredFiles.map((file, index) => {
                    const lectureNum = file.lecture || null;
                    const lectureColor = lectureNum ? getLectureColor(lectureNum) : null;

                    return (
                      <TableRow key={index} hover sx={{ '&:hover': { backgroundColor: 'rgba(102, 126, 234, 0.04)' } }}>
                        <TableCell>
                          <Stack direction="row" spacing={1.5} alignItems="center">
                            <Box sx={{ fontSize: 24 }}>📄</Box>
                            <Box>
                              <Typography variant="body2" fontWeight={600} color="text.primary">
                                {file.title || file.name}
                              </Typography>
                              {file.name !== file.title && (
                                <Typography variant="caption" color="text.secondary">
                                  {file.name}
                                </Typography>
                              )}
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={getCategoryDisplayName(file.category)}
                            size="small"
                            sx={{
                              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                              color: 'white',
                              fontWeight: 500,
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          {lectureNum ? (
                            <Chip
                              label={'L' + lectureNum}
                              size="small"
                              sx={{
                                backgroundColor: lectureColor,
                                color: 'white',
                                fontWeight: 600,
                              }}
                            />
                          ) : (
                            <Typography variant="body2" color="text.disabled">—</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                            {file.directory || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Stack direction="row" spacing={1} justifyContent="center">
                            <Tooltip title="Open PDF">
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => window.open('/' + file.path, '_blank')}
                              >
                                <Visibility />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Copy link">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  navigator.clipboard.writeText(window.location.origin + '/' + file.path);
                                  alert('Link copied!');
                                }}
                              >
                                <LinkIcon />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {filteredFiles.length > 0 && (
            <Typography variant="caption" color="text.secondary" textAlign="center" display="block" mt={2}>
              Showing {filteredFiles.length} of {flatFiles.length} total documents
            </Typography>
          )}
        </Paper>
      </Box>
    </>
  );
};

export default Home;

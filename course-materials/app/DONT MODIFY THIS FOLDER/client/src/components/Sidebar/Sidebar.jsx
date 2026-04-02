import React from 'react';
import { Link } from 'react-router-dom';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Chip,
  Box,
  Divider,
  Card,
  CardContent,
  Stack,
} from '@mui/material';
import {
  MenuBook,
  History as HistoryIcon,
  Star,
  Folder,
  FolderOpen,
} from '@mui/icons-material';
import { useApp } from '../../contexts/AppContext';
import { timeAgo, getLectureColor, getCategoryDisplayName } from '../../utils/helpers';

const Sidebar = ({ onFilterByCategory, onFilterByLecture, activeCategory, onOpenPDF }) => {
  const { pdfStructure, history, currentSubject } = useApp();

  const lectures = Object.keys(pdfStructure.notes || {}).sort((a, b) => {
    const numA = parseInt(a.replace(/\D/g, '')) || 0;
    const numB = parseInt(b.replace(/\D/g, '')) || 0;
    return numA - numB;
  });

  const counts = {
    all: 0,
    notes: Object.values(pdfStructure.notes || {}).flat().length,
    slides: (pdfStructure.slides || []).length,
    exercises: (pdfStructure.exercises || []).length,
    'exercises-no-solutions': (pdfStructure.exercisesNoSolutions || []).length,
    blueprint: (pdfStructure.blueprint || []).length,
    'teachers-method': (pdfStructure.teachersMethod || []).length,
  };

  counts.all = counts.notes + counts.slides + counts.exercises + counts['exercises-no-solutions'] + counts.blueprint + counts['teachers-method'];

  Object.entries(pdfStructure.customCategories || {}).forEach(([key, files]) => {
    counts[key] = files.length;
    counts.all += files.length;
  });

  const recentHistory = (history || []).slice(0, 6);

  const categories = [
    { key: 'notes', label: 'Lecture Notes', icon: '📝', color: '#10b981' },
    { key: 'slides', label: 'Lecture Slides', icon: '📊', color: '#3b82f6' },
    { key: 'exercises', label: 'Exercises', icon: '💪', color: '#f59e0b' },
    { key: 'exercises-no-solutions', label: 'Ex (No Sol)', icon: '❓', color: '#6b7280' },
    { key: 'blueprint', label: 'Blueprint', icon: '🗺️', color: '#8b5cf6' },
    { key: 'teachers-method', label: 'Teachers', icon: '👨‍🏫', color: '#ef4444' },
  ];

  return (
    <Box
      sx={{
        width: 280,
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderRadius: 3,
        p: 2,
        maxHeight: 'calc(100vh - 200px)',
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        '&::-webkit-scrollbar': {
          width: '6px',
        },
        '&::-webkit-scrollbar-thumb': {
          background: 'rgba(102, 126, 234, 0.3)',
          borderRadius: '3px',
        },
      }}
    >
      {/* Lectures */}
      {lectures.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main', mb: 1, display: 'block' }}>
            <MenuBook sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
            LECTURES
          </Typography>
          <List dense>
            {lectures.map((lecture) => {
              const lectureNum = parseInt(lecture.replace(/\D/g, '')) || 0;
              const color = getLectureColor(lectureNum);
              return (
                <ListItem key={lecture} disablePadding>
                  <ListItemButton
                    onClick={() => onFilterByLecture(lecture)}
                    sx={{ borderRadius: 2, mb: 0.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <MenuBook sx={{ color, fontSize: 20 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={`Lecture ${lectureNum}`}
                      primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                    />
                    <Chip
                      label={pdfStructure.notes[lecture].length}
                      size="small"
                      sx={{ backgroundColor: color, color: 'white', height: 20, fontSize: 11 }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
      )}

      {/* Recent History */}
      {recentHistory.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'info.main', mb: 1, display: 'block' }}>
            <HistoryIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
            RECENT
          </Typography>
          <Stack spacing={1}>
            {recentHistory.map((item, index) => (
              <Card
                key={index}
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  '&:hover': {
                    boxShadow: 3,
                    transform: 'translateY(-2px)',
                  },
                }}
                onClick={() => onOpenPDF && onOpenPDF(item.title, item.path, item.category)}
              >
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {item.title}
                  </Typography>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" mt={0.5}>
                    <Chip
                      label={getCategoryDisplayName(item.category)}
                      size="small"
                      sx={{ height: 18, fontSize: 10 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {timeAgo(item.timestamp)}
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        </Box>
      )}

      <Divider sx={{ my: 2 }} />

      {/* Favorites */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'warning.main', mb: 1, display: 'block' }}>
          <Star sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
          FAVORITES
        </Typography>
        <List dense>
          <ListItem disablePadding>
            <ListItemButton
              selected={activeCategory === 'all'}
              onClick={() => onFilterByCategory('all')}
              sx={{ borderRadius: 2 }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <FolderOpen sx={{ fontSize: 20 }} />
              </ListItemIcon>
              <ListItemText primary="All Files" primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }} />
              <Chip label={counts.all} size="small" color="primary" sx={{ height: 20, fontSize: 11 }} />
            </ListItemButton>
          </ListItem>
        </List>
      </Box>

      {/* Categories */}
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'success.main', mb: 1, display: 'block' }}>
          <Folder sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
          CATEGORIES
        </Typography>
        <List dense>
          {categories.map((cat) => (
            <ListItem key={cat.key} disablePadding>
              <ListItemButton
                selected={activeCategory === cat.key}
                onClick={() => onFilterByCategory(cat.key)}
                sx={{ borderRadius: 2, mb: 0.5 }}
              >
                <ListItemText
                  primary={`${cat.icon} ${cat.label}`}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                />
                <Chip
                  label={counts[cat.key]}
                  size="small"
                  sx={{
                    backgroundColor: cat.color,
                    color: 'white',
                    height: 20,
                    fontSize: 11,
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>
    </Box>
  );
};

export default Sidebar;

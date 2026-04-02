import React from 'react';
import { Link } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Typography,
  TextField,
  Button,
  ButtonGroup,
  Chip,
  Box,
  InputAdornment,
  Stack,
} from '@mui/material';
import {
  Settings,
  Upload,
  History,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useApp } from '../../contexts/AppContext';

const Navbar = ({ searchTerm, onSearchChange, currentView, onViewChange }) => {
  const { currentSubject } = useApp();

  if (!currentSubject) return null;

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(10px)',
        borderRadius: 3,
        mb: 2,
      }}
    >
      <Toolbar sx={{ py: 1 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              variant="h6"
              component="div"
              sx={{
                fontWeight: 700,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {currentSubject.name}
            </Typography>
            <Chip
              label={currentSubject.semester}
              size="small"
              sx={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                fontWeight: 600,
              }}
            />
          </Box>

          <Button
            component={Link}
            to="/subjects"
            startIcon={<Settings />}
            variant="outlined"
            size="small"
            sx={{ borderRadius: 2 }}
          >
            Subjects
          </Button>

          <Button
            component={Link}
            to="/upload"
            startIcon={<Upload />}
            variant="contained"
            size="small"
            sx={{ borderRadius: 2 }}
          >
            Upload
          </Button>

          <Button
            component={Link}
            to="/history"
            startIcon={<History />}
            variant="outlined"
            size="small"
            sx={{ borderRadius: 2 }}
          >
            History
          </Button>
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            size="small"
            placeholder="Search PDFs..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
            sx={{
              width: 300,
              '& .MuiOutlinedInput-root': {
                borderRadius: 8,
              },
            }}
          />

          <ButtonGroup variant="outlined" size="small">
            {['all', 'notes', 'slides', 'exercises'].map((view) => (
              <Button
                key={view}
                onClick={() => onViewChange(view)}
                variant={currentView === view ? 'contained' : 'outlined'}
                sx={{ textTransform: 'capitalize' }}
              >
                {view}
              </Button>
            ))}
          </ButtonGroup>
        </Stack>
      </Toolbar>
    </AppBar>
  );
};

export default Navbar;

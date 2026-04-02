import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AppProvider } from './contexts/AppContext';
import theme from './theme';
import Layout from './components/Layout/Layout';
import Home from './pages/Home/Home';
import Subjects from './pages/Subjects/Subjects';
import History from './pages/History/History';
import Upload from './pages/Upload/Upload';
import BootSplash from './components/BootSplash/BootSplash';

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppProvider>
        <Router>
          <BootSplash />
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="view" element={<Home />} />
              <Route path="subjects" element={<Subjects />} />
              <Route path="history" element={<History />} />
              <Route path="upload" element={<Upload />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Router>
      </AppProvider>
    </ThemeProvider>
  );
}

export default App;

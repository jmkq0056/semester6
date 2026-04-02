import React from 'react';
import { Outlet } from 'react-router-dom';
import { Box } from '@mui/material';

const Layout = () => {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        p: 0,
      }}
    >
      <Outlet />
    </Box>
  );
};

export default Layout;

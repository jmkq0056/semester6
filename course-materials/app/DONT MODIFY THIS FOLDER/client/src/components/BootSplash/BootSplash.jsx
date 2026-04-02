import React, { useState, useEffect } from 'react';
import { shouldShowBootSplash, incrementBootSplashCount } from '../../utils/helpers';
import './BootSplash.css';

const BootSplash = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (shouldShowBootSplash()) {
      setShow(true);
      incrementBootSplashCount();

      // Fade out after 2.5 seconds
      const timer = setTimeout(() => {
        setShow(false);
      }, 2500);

      return () => clearTimeout(timer);
    }
  }, []);

  if (!show) return null;

  return (
    <div className={`boot-splash ${!show ? 'fade-out' : ''}`}>
      <img src="/erdetdetduvil.jpg" alt="Loading..." />
    </div>
  );
};

export default BootSplash;

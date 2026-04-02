// Time formatting utilities
export const timeAgo = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString();
};

// File name sanitization
export const sanitizeFilename = (filename) => {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Extract lecture number from filename or path
export const extractLectureNumber = (filename, path) => {
  // Try filename first
  const fileMatch = filename.match(/(?:lec(?:ture)?[-_]?|l)(\d+)/i);
  if (fileMatch) return parseInt(fileMatch[1], 10);

  // Try path
  const pathMatch = path.match(/lecture[-_]?(\d+)/i);
  if (pathMatch) return parseInt(pathMatch[1], 10);

  return null;
};

// Get lecture color
const LECTURE_COLORS = [
  '#000000', // L1: Black
  '#0080FF', // L2: Electric Blue
  '#FFD700', // L3: Vivid Yellow
  '#00FF00', // L4: Lime Green
  '#9D00FF', // L5: Neon Purple
  '#FF4500', // L6: Deep Orange
  '#00CED1', // L7: Cyan Sky
  '#FFA500', // L8: Golden Yellow
  '#DC143C', // L9: Magenta Crimson
  '#4B0082', // L10: Indigo Glow
  '#7FFFD4', // L11: Aqua Mint
  '#FF1493', // L12: Shock Pink
  '#8B00FF', // L13: Ultra Violet
  '#39FF14', // L14: Neon Green
];

export const getLectureColor = (lectureNumber) => {
  if (!lectureNumber) return '#666';
  const index = (lectureNumber - 1) % LECTURE_COLORS.length;
  return LECTURE_COLORS[index];
};

// Category display names
export const getCategoryDisplayName = (category) => {
  const categoryMap = {
    'notes': 'Lecture Notes',
    'slides': 'Lecture Slides',
    'exercises': 'Exercises',
    'exercises-no-solutions': 'Ex (No Sol)',
    'blueprint': 'Blueprint',
    'teachers-method': 'Teachers',
  };
  return categoryMap[category] || category;
};

// File size formatting
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

// Build flat file list from PDF structure
export const buildFlatFileList = (pdfStructure) => {
  const flatList = [];

  // Add notes
  Object.entries(pdfStructure.notes).forEach(([lecture, files]) => {
    files.forEach(file => {
      flatList.push({ ...file, category: 'notes', lecture });
    });
  });

  // Add other categories
  pdfStructure.slides.forEach(file => flatList.push({ ...file, category: 'slides' }));
  pdfStructure.exercises.forEach(file => flatList.push({ ...file, category: 'exercises' }));
  pdfStructure.exercisesNoSolutions.forEach(file =>
    flatList.push({ ...file, category: 'exercises-no-solutions' })
  );
  pdfStructure.blueprint.forEach(file => flatList.push({ ...file, category: 'blueprint' }));
  pdfStructure.teachersMethod.forEach(file =>
    flatList.push({ ...file, category: 'teachers-method' })
  );

  // Add custom categories
  Object.entries(pdfStructure.customCategories).forEach(([category, files]) => {
    files.forEach(file => flatList.push({ ...file, category }));
  });

  return flatList;
};

// Search/filter files
export const filterFiles = (files, searchTerm, categoryFilter = null, lectureFilter = null) => {
  let filtered = [...files];

  // Apply search term
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(file =>
      file.name.toLowerCase().includes(term) ||
      file.path.toLowerCase().includes(term)
    );
  }

  // Apply category filter
  if (categoryFilter) {
    filtered = filtered.filter(file => file.category === categoryFilter);
  }

  // Apply lecture filter
  if (lectureFilter) {
    filtered = filtered.filter(file => file.lecture === lectureFilter);
  }

  return filtered;
};

// Parse URL query parameters
export const parseQueryParams = (search) => {
  const params = new URLSearchParams(search);
  return {
    left: params.get('left'),
    right: params.get('right'),
    ratio: params.get('ratio') || '50',
  };
};

// Build URL with query parameters
export const buildViewUrl = (leftPath, rightPath = null, ratio = '50') => {
  const params = new URLSearchParams();
  if (leftPath) params.set('left', leftPath);
  if (rightPath) params.set('right', rightPath);
  if (ratio !== '50') params.set('ratio', ratio);

  return `/view?${params.toString()}`;
};

// Local storage helpers
export const getLocalStorageItem = (key, defaultValue = null) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error('Error reading from localStorage:', error);
    return defaultValue;
  }
};

export const setLocalStorageItem = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Error writing to localStorage:', error);
  }
};

// Boot splash tracking
export const shouldShowBootSplash = () => {
  const viewCount = getLocalStorageItem('bootSplashViewCount', 0);
  return viewCount < 2;
};

export const incrementBootSplashCount = () => {
  const viewCount = getLocalStorageItem('bootSplashViewCount', 0);
  setLocalStorageItem('bootSplashViewCount', viewCount + 1);
};

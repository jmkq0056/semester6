import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Files & Subject Management
export const getFiles = async (subjectCode = null) => {
  const url = subjectCode ? `/files/${subjectCode}` : '/files';
  const response = await api.get(url);
  return response.data;
};

export const getSubjects = async () => {
  const response = await api.get('/subjects');
  return response.data;
};

export const getCurrentSubject = async () => {
  const response = await api.get('/current-subject');
  return response.data;
};

export const setCurrentSubject = async (code) => {
  const response = await api.post('/set-current-subject', { code });
  return response.data;
};

export const createSubject = async (subjectData) => {
  const response = await api.post('/subjects', subjectData);
  return response.data;
};

export const updateSubject = async (id, subjectData) => {
  const response = await api.put(`/subjects/${id}`, subjectData);
  return response.data;
};

export const deleteSubject = async (id) => {
  const response = await api.delete(`/subjects/${id}`);
  return response.data;
};

// File Operations
export const uploadPDF = async (formData, onProgress) => {
  const response = await api.post('/upload-pdf', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress) {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        onProgress(percentCompleted);
      }
    },
  });
  return response.data;
};

export const deleteFile = async (filePath) => {
  const response = await api.delete('/file', { data: { path: filePath } });
  return response.data;
};

export const moveFile = async (oldPath, newPath, category, lectureNumber) => {
  const response = await api.post('/file/move', {
    oldPath,
    newPath,
    category,
    lectureNumber,
  });
  return response.data;
};

// History & Analytics
export const addToHistory = async (historyData) => {
  const response = await api.post('/history', historyData);
  return response.data;
};

export const getHistory = async () => {
  const response = await api.get('/history');
  return response.data;
};

export const clearHistory = async () => {
  const response = await api.delete('/history');
  return response.data;
};

export const deleteHistoryItem = async (path) => {
  const response = await api.delete(`/history/${encodeURIComponent(path)}`);
  return response.data;
};

export const getStatistics = async () => {
  const response = await api.get('/statistics');
  return response.data;
};

export const exportData = async () => {
  const response = await api.get('/export');
  return response.data;
};

// Custom Categories
export const getCustomCategories = async (subjectCode) => {
  const response = await api.get(`/custom-categories/${subjectCode}`);
  return response.data;
};

export default api;

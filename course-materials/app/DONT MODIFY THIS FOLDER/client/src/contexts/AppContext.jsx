import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as api from '../services/api';

const AppContext = createContext();

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

export const AppProvider = ({ children }) => {
  const [currentSubject, setCurrentSubject] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfStructure, setPdfStructure] = useState({
    notes: {},
    slides: [],
    exercises: [],
    exercisesNoSolutions: [],
    blueprint: [],
    teachersMethod: [],
    customCategories: {},
  });

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [subjectsResponse, currentSubjectResponse, historyResponse] = await Promise.all([
        api.getSubjects(),
        api.getCurrentSubject(),
        api.getHistory(),
      ]);

      // Extract data from API responses
      const subjectsData = subjectsResponse.subjects || [];
      const currentSubjectData = currentSubjectResponse.subject || null;
      const historyData = historyResponse.history || [];

      setSubjects(subjectsData);
      setCurrentSubject(currentSubjectData);
      setHistory(historyData);

      // Load files for current subject
      if (currentSubjectData) {
        await loadFiles(currentSubjectData.code);
      }
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadFiles = async (subjectCode) => {
    try {
      const response = await api.getFiles(subjectCode);
      console.log('API Response:', response);

      // API returns { success, subject, structure, totalFiles }
      if (response.structure) {
        setPdfStructure({
          notes: response.structure.notes || {},
          slides: response.structure.slides || [],
          exercises: response.structure.exercises || [],
          exercisesNoSolutions: response.structure.exercisesNoSolutions || [],
          blueprint: response.structure.blueprint || [],
          teachersMethod: response.structure.teachersMethod || [],
          customCategories: response.structure.customCategories || {},
        });

        // Build flat file list for backwards compatibility
        const allFiles = [
          ...Object.values(response.structure.notes || {}).flat(),
          ...(response.structure.slides || []),
          ...(response.structure.exercises || []),
          ...(response.structure.exercisesNoSolutions || []),
          ...(response.structure.blueprint || []),
          ...(response.structure.teachersMethod || []),
          ...Object.values(response.structure.customCategories || {}).flat(),
        ];
        setFiles(allFiles);
      }
    } catch (error) {
      console.error('Error loading files:', error);
    }
  };

  const switchSubject = async (code) => {
    try {
      await api.setCurrentSubject(code);
      const newCurrentSubject = subjects.find((s) => s.code === code);
      setCurrentSubject(newCurrentSubject);
      await loadFiles(code);
      await refreshHistory();
    } catch (error) {
      console.error('Error switching subject:', error);
    }
  };

  const refreshFiles = useCallback(async () => {
    if (currentSubject) {
      await loadFiles(currentSubject.code);
    }
  }, [currentSubject]);

  const refreshHistory = async () => {
    try {
      const historyResponse = await api.getHistory();
      const historyData = historyResponse.history || [];
      setHistory(historyData);
    } catch (error) {
      console.error('Error refreshing history:', error);
    }
  };

  const addToHistoryLocal = async (historyData) => {
    try {
      await api.addToHistory(historyData);
      await refreshHistory();
    } catch (error) {
      console.error('Error adding to history:', error);
    }
  };

  const value = {
    currentSubject,
    subjects,
    files,
    history,
    loading,
    pdfStructure,
    switchSubject,
    refreshFiles,
    refreshHistory,
    addToHistoryLocal,
    loadInitialData,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

/**
 * ML-Powered PDF Search Engine
 * Uses TF-IDF, cosine similarity, and intelligent ranking algorithms
 * Works completely in the browser with no backend dependencies
 */

class PDFSearchEngine {
    constructor() {
        this.index = new Map(); // PDF path -> { pages: [], metadata: {} }
        this.idfScores = new Map(); // term -> IDF score
        this.totalDocuments = 0;
        this.db = null;
        this.isIndexing = false;
        this.indexingProgress = { current: 0, total: 0 };

        // Initialize IndexedDB for caching
        this.initDatabase();
    }

    /**
     * Initialize IndexedDB for persistent caching
     */
    async initDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('PDFSearchDB', 1);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object stores
                if (!db.objectStoreNames.contains('pdfContent')) {
                    const store = db.createObjectStore('pdfContent', { keyPath: 'path' });
                    store.createIndex('lastIndexed', 'lastIndexed', { unique: false });
                }

                if (!db.objectStoreNames.contains('searchIndex')) {
                    db.createObjectStore('searchIndex', { keyPath: 'id' });
                }
            };
        });
    }

    /**
     * Tokenize and normalize text
     */
    tokenize(text) {
        if (!text) return [];

        // Convert to lowercase and extract words
        const tokens = text.toLowerCase()
            .replace(/[^\w\s-]/g, ' ') // Keep hyphens for terms like "machine-learning"
            .split(/\s+/)
            .filter(token => token.length > 2); // Filter out very short words

        // Apply stemming (simple Porter-like stemmer)
        return tokens.map(token => this.stem(token));
    }

    /**
     * Simple stemming algorithm
     */
    stem(word) {
        // Remove common suffixes
        word = word.replace(/ing$/, '');
        word = word.replace(/ed$/, '');
        word = word.replace(/ly$/, '');
        word = word.replace(/ness$/, '');
        word = word.replace(/ment$/, '');
        word = word.replace(/ation$/, '');
        word = word.replace(/s$/, '');
        return word;
    }

    /**
     * Calculate TF (Term Frequency) for a document
     */
    calculateTF(tokens) {
        const tf = new Map();
        const total = tokens.length;

        for (const token of tokens) {
            tf.set(token, (tf.get(token) || 0) + 1);
        }

        // Normalize by total tokens
        for (const [term, count] of tf.entries()) {
            tf.set(term, count / total);
        }

        return tf;
    }

    /**
     * Calculate IDF (Inverse Document Frequency) scores across all documents
     */
    calculateIDF() {
        const documentFrequency = new Map(); // term -> number of documents containing term

        // Count document frequency for each term
        for (const [path, doc] of this.index.entries()) {
            const uniqueTerms = new Set();

            for (const page of doc.pages) {
                for (const term of page.tokens) {
                    uniqueTerms.add(term);
                }
            }

            for (const term of uniqueTerms) {
                documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
            }
        }

        // Calculate IDF scores
        this.idfScores.clear();
        for (const [term, df] of documentFrequency.entries()) {
            this.idfScores.set(term, Math.log(this.totalDocuments / df));
        }
    }

    /**
     * Calculate cosine similarity between query and document
     */
    cosineSimilarity(queryVector, docVector) {
        let dotProduct = 0;
        let queryMagnitude = 0;
        let docMagnitude = 0;

        const allTerms = new Set([...queryVector.keys(), ...docVector.keys()]);

        for (const term of allTerms) {
            const queryWeight = queryVector.get(term) || 0;
            const docWeight = docVector.get(term) || 0;

            dotProduct += queryWeight * docWeight;
            queryMagnitude += queryWeight * queryWeight;
            docMagnitude += docWeight * docWeight;
        }

        if (queryMagnitude === 0 || docMagnitude === 0) return 0;

        return dotProduct / (Math.sqrt(queryMagnitude) * Math.sqrt(docMagnitude));
    }

    /**
     * Extract text from PDF using PDF.js
     */
    async extractTextFromPDF(pdfUrl) {
        try {
            // Load PDF.js library if not already loaded
            if (typeof pdfjsLib === 'undefined') {
                await this.loadPDFJS();
            }

            const loadingTask = pdfjsLib.getDocument(pdfUrl);
            const pdf = await loadingTask.promise;
            const pages = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(item => item.str).join(' ');

                pages.push({
                    pageNumber: i,
                    text: text,
                    tokens: this.tokenize(text),
                    tf: null // Will be calculated later
                });
            }

            return pages;
        } catch (error) {
            console.error('Error extracting text from PDF:', error);
            return [];
        }
    }

    /**
     * Load PDF.js library dynamically
     */
    async loadPDFJS() {
        return new Promise((resolve, reject) => {
            if (typeof pdfjsLib !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.onload = () => {
                pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    /**
     * Index a single PDF
     */
    async indexPDF(pdfPath, pdfTitle, category) {
        try {
            // Check cache first
            const cached = await this.getCachedContent(pdfPath);
            if (cached && cached.pages && cached.pages.length > 0) {
                this.index.set(pdfPath, cached);
                return true;
            }

            // Extract text from PDF
            const pages = await this.extractTextFromPDF(pdfPath);

            if (pages.length === 0) {
                console.warn('No pages extracted from:', pdfPath);
                return false;
            }

            // Calculate TF for each page
            for (const page of pages) {
                page.tf = this.calculateTF(page.tokens);
            }

            // Store in index
            const docData = {
                path: pdfPath,
                title: pdfTitle,
                category: category,
                pages: pages,
                lastIndexed: Date.now()
            };

            this.index.set(pdfPath, docData);

            // Cache in IndexedDB
            await this.cacheContent(docData);

            return true;
        } catch (error) {
            console.error('Error indexing PDF:', pdfPath, error);
            return false;
        }
    }

    /**
     * Index all PDFs from the structure
     */
    async indexAllPDFs(pdfStructure, progressCallback) {
        this.isIndexing = true;
        const allPDFs = [];

        // Collect all PDFs
        if (pdfStructure.notes) {
            for (const [category, pdfs] of Object.entries(pdfStructure.notes)) {
                if (Array.isArray(pdfs)) {
                    for (const pdf of pdfs) {
                        allPDFs.push({ path: pdf.path, title: pdf.title, category });
                    }
                }
            }
        }

        if (Array.isArray(pdfStructure.slides)) {
            for (const pdf of pdfStructure.slides) {
                allPDFs.push({ path: pdf.path, title: pdf.title, category: 'Lecture Slides' });
            }
        }

        if (Array.isArray(pdfStructure.exercises)) {
            for (const pdf of pdfStructure.exercises) {
                allPDFs.push({ path: pdf.path, title: pdf.title, category: 'Exercises' });
            }
        }

        if (Array.isArray(pdfStructure.exercisesNoSolutions)) {
            for (const pdf of pdfStructure.exercisesNoSolutions) {
                allPDFs.push({ path: pdf.path, title: pdf.title, category: 'Exercises (No Solutions)' });
            }
        }

        if (Array.isArray(pdfStructure.blueprint)) {
            for (const pdf of pdfStructure.blueprint) {
                allPDFs.push({ path: pdf.path, title: pdf.title, category: 'Blueprint' });
            }
        }

        if (Array.isArray(pdfStructure.teachersMethod)) {
            for (const pdf of pdfStructure.teachersMethod) {
                allPDFs.push({ path: pdf.path, title: pdf.title, category: 'Teachers Method' });
            }
        }

        // Index custom categories
        if (pdfStructure.customCategories) {
            for (const [categoryName, pdfs] of Object.entries(pdfStructure.customCategories)) {
                if (Array.isArray(pdfs)) {
                    for (const pdf of pdfs) {
                        allPDFs.push({ path: pdf.path, title: pdf.title, category: pdf.category || categoryName });
                    }
                }
            }
        }

        this.indexingProgress.total = allPDFs.length;
        this.indexingProgress.current = 0;

        // Index PDFs in batches to avoid blocking
        const batchSize = 3;
        for (let i = 0; i < allPDFs.length; i += batchSize) {
            const batch = allPDFs.slice(i, i + batchSize);

            await Promise.all(
                batch.map(pdf =>
                    this.indexPDF(pdf.path, pdf.title, pdf.category)
                        .then(() => {
                            this.indexingProgress.current++;
                            if (progressCallback) {
                                progressCallback(this.indexingProgress);
                            }
                        })
                )
            );
        }

        this.totalDocuments = this.index.size;
        this.calculateIDF();

        this.isIndexing = false;

        return this.index.size;
    }

    /**
     * Search across all indexed PDFs
     */
    search(query, options = {}) {
        const {
            maxResults = 20,
            minScore = 0.1,
            includePageContent = true
        } = options;

        if (!query || query.trim().length < 2) {
            return [];
        }

        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0) {
            return [];
        }

        // Calculate query TF-IDF vector
        const queryTF = this.calculateTF(queryTokens);
        const queryVector = new Map();

        for (const [term, tf] of queryTF.entries()) {
            const idf = this.idfScores.get(term) || 0;
            queryVector.set(term, tf * idf);
        }

        const results = [];

        // Search each document
        for (const [path, doc] of this.index.entries()) {
            // Calculate document-level score
            const docTokens = [];
            for (const page of doc.pages) {
                docTokens.push(...page.tokens);
            }

            const docTF = this.calculateTF(docTokens);
            const docVector = new Map();

            for (const [term, tf] of docTF.entries()) {
                const idf = this.idfScores.get(term) || 0;
                docVector.set(term, tf * idf);
            }

            const docScore = this.cosineSimilarity(queryVector, docVector);

            // Search individual pages
            const pageMatches = [];
            for (const page of doc.pages) {
                const pageTF = page.tf;
                const pageVector = new Map();

                for (const [term, tf] of pageTF.entries()) {
                    const idf = this.idfScores.get(term) || 0;
                    pageVector.set(term, tf * idf);
                }

                const pageScore = this.cosineSimilarity(queryVector, pageVector);

                // Check for exact phrase matches (boost score)
                let phraseBoost = 0;
                const lowerText = page.text.toLowerCase();
                const lowerQuery = query.toLowerCase();
                if (lowerText.includes(lowerQuery)) {
                    phraseBoost = 0.5;
                }

                const finalScore = pageScore + phraseBoost;

                if (finalScore > minScore) {
                    pageMatches.push({
                        pageNumber: page.pageNumber,
                        score: finalScore,
                        text: includePageContent ? page.text : null,
                        preview: this.generatePreview(page.text, query)
                    });
                }
            }

            if (pageMatches.length > 0 || docScore > minScore) {
                // Sort pages by score
                pageMatches.sort((a, b) => b.score - a.score);

                results.push({
                    path: doc.path,
                    title: doc.title,
                    category: doc.category,
                    score: Math.max(docScore, ...pageMatches.map(p => p.score)),
                    documentScore: docScore,
                    pages: pageMatches,
                    totalPages: doc.pages.length
                });
            }
        }

        // Sort results by score
        results.sort((a, b) => b.score - a.score);

        return results.slice(0, maxResults);
    }

    /**
     * Generate preview snippet with highlighted query terms
     */
    generatePreview(text, query, contextLength = 150) {
        if (!text) return '';

        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();

        // Find first occurrence of query
        let index = lowerText.indexOf(lowerQuery);

        if (index === -1) {
            // Try to find individual words
            const queryWords = lowerQuery.split(/\s+/);
            for (const word of queryWords) {
                index = lowerText.indexOf(word);
                if (index !== -1) break;
            }
        }

        if (index === -1) {
            // No match found, return beginning
            return text.substring(0, contextLength) + '...';
        }

        // Extract context around match
        const start = Math.max(0, index - contextLength / 2);
        const end = Math.min(text.length, index + query.length + contextLength / 2);

        let preview = text.substring(start, end);

        if (start > 0) preview = '...' + preview;
        if (end < text.length) preview = preview + '...';

        return preview;
    }

    /**
     * Cache content in IndexedDB
     */
    async cacheContent(docData) {
        if (!this.db) return;

        try {
            const transaction = this.db.transaction(['pdfContent'], 'readwrite');
            const store = transaction.objectStore('pdfContent');
            await store.put(docData);
        } catch (error) {
            console.error('Error caching content:', error);
        }
    }

    /**
     * Get cached content from IndexedDB
     */
    async getCachedContent(pdfPath) {
        if (!this.db) return null;

        try {
            const transaction = this.db.transaction(['pdfContent'], 'readonly');
            const store = transaction.objectStore('pdfContent');
            const request = store.get(pdfPath);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting cached content:', error);
            return null;
        }
    }

    /**
     * Clear all cached data
     */
    async clearCache() {
        if (!this.db) return;

        try {
            const transaction = this.db.transaction(['pdfContent'], 'readwrite');
            const store = transaction.objectStore('pdfContent');
            await store.clear();

            this.index.clear();
            this.idfScores.clear();
            this.totalDocuments = 0;
        } catch (error) {
            console.error('Error clearing cache:', error);
        }
    }

    /**
     * Get indexing status
     */
    getIndexingStatus() {
        return {
            isIndexing: this.isIndexing,
            progress: this.indexingProgress,
            totalIndexed: this.index.size
        };
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFSearchEngine;
}

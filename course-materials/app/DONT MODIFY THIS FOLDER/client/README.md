# Course Materials PDF Viewer - React + Vite

A modern, feature-rich PDF viewer application built with React and Vite for managing and viewing course materials.

## Features

- **Multi-Subject Support**: Manage multiple subjects with custom colors and icons
- **PDF Viewing**: Native browser PDF viewing with split-view comparison
- **Advanced Search**: Fast, offline search with fuzzy matching and synonyms
- **History Tracking**: Automatic history with last 60 days of viewed documents
- **Smart Organization**: Auto-categorization by lecture, slides, exercises, etc.
- **Split View**: Compare two PDFs side-by-side with resizable panes
- **File Management**: Upload, organize, and manage PDF files
- **Responsive UI**: Modern, macOS-inspired design with glassmorphism effects

## Tech Stack

- **Frontend**: React 18 + Vite
- **Routing**: React Router DOM
- **HTTP Client**: Axios
- **Styling**: Bootstrap 5 + Custom CSS
- **Icons**: Font Awesome 6
- **Backend**: Node.js + Express (in ../server/)
- **Database**: SQLite (better-sqlite3)

## Project Structure

```
client/
├── public/               # Static assets
├── src/
│   ├── components/       # React components
│   │   ├── BootSplash/  # Loading splash screen
│   │   ├── Layout/      # Main layout wrapper
│   │   ├── Navbar/      # Top navigation bar
│   │   └── Sidebar/     # Left sidebar with categories
│   ├── contexts/        # React contexts
│   │   └── AppContext.jsx  # Global app state
│   ├── pages/           # Page components
│   │   ├── Home/        # Main PDF viewer page
│   │   ├── Subjects/    # Subject management
│   │   ├── History/     # View history
│   │   └── Upload/      # Upload PDFs
│   ├── services/        # API services
│   │   └── api.js       # API client
│   ├── styles/          # CSS files
│   ├── utils/           # Utility functions
│   │   └── helpers.js   # Helper functions
│   ├── App.jsx          # Main app component
│   └── main.jsx         # Entry point
├── index.html           # HTML template
├── vite.config.js       # Vite configuration
└── package.json         # Dependencies

```

## Installation

### Prerequisites

- Node.js 18+ (or 16+)
- npm or yarn

### Setup

1. **Install dependencies**:
   ```bash
   cd client
   npm install
   ```

2. **Start the backend server** (in another terminal):
   ```bash
   cd ../server
   npm start
   ```
   The backend runs on http://localhost:3000

3. **Start the React development server**:
   ```bash
   npm run dev
   ```
   The frontend runs on http://localhost:5173

4. **Open your browser** and navigate to http://localhost:5173

## Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint

### API Proxy

The Vite dev server proxies API requests to the backend:
- `/api/*` → `http://localhost:3000/api/*`
- `/subjects/*` → `http://localhost:3000/subjects/*`

This is configured in `vite.config.js`.

## Usage

### Viewing PDFs

1. Browse files in the main content area
2. Click on a PDF to open it
3. Use the search bar to filter files
4. Click category buttons in sidebar to filter

### Split View

1. Open a PDF
2. Click "Split View" button
3. Select a second PDF from the sidebar
4. Resize panes by dragging the divider

### Managing Subjects

1. Click "Subjects" in the navbar
2. Add new subjects with custom colors/icons
3. Switch between subjects
4. Each subject has its own file organization

### Uploading PDFs

1. Click "Upload" in the navbar
2. Select category and lecture number
3. Choose PDF file (max 50MB)
4. File is auto-organized into subject directory

### History

1. Click "History" in the navbar
2. View all recently accessed PDFs
3. Click any item to reopen
4. Split-view history is automatically restored

## Key Features

### Auto-Categorization

PDFs are automatically categorized based on directory structure:
- `notes/lecture-N/` → Lecture N Notes
- `slides/` or filename contains "slide" → Lecture Slides
- `exercises/` → Exercises (with solutions)
- `exercises-no-solutions/` → Exercises (no solutions)
- `blueprint/` → Blueprint
- `teachers-method/` → Teachers Method
- Custom directories → Custom Categories

### Lecture Color Coding

Each lecture (1-14) has a unique neon color:
- L1: Black
- L2: Electric Blue
- L3: Vivid Yellow
- L4: Lime Green
- L5: Neon Purple
- L6: Deep Orange
- L7: Cyan Sky
- L8: Golden Yellow
- L9: Magenta Crimson
- L10: Indigo Glow
- L11: Aqua Mint
- L12: Shock Pink
- L13: Ultra Violet
- L14: Neon Green

### Boot Splash

- Shows a splash screen on first 2 visits
- Auto-fades after 2.5 seconds
- Tracked in localStorage

## Environment

The app works with the existing backend server structure:

```
course-materials/app/
├── server/          # Backend (Node.js/Express)
├── client/          # Frontend (React/Vite) ← You are here
├── data/            # Database and uploads
└── subjects/        # Subject-specific content
    └── {CODE}/      # e.g., MACHINE-INT/
        ├── notes/
        ├── slides/
        ├── exercises/
        └── ...
```

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Troubleshooting

### Port Already in Use

If port 5173 is already in use:
```bash
# Change port in vite.config.js
server: {
  port: 5174,  // Use different port
  ...
}
```

### API Connection Issues

1. Ensure backend server is running on port 3000
2. Check proxy configuration in `vite.config.js`
3. Check browser console for errors

### PDFs Not Loading

1. Verify subject directory exists in `../subjects/{CODE}/`
2. Check file permissions
3. Ensure PDF files have `.pdf` extension (lowercase)

## Contributing

This is a course project. For major changes, please discuss with the team first.

## License

Private - Educational Use Only

---

**Built with** ❤️ **using React + Vite**

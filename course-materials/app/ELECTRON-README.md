# Course Materials Viewer - Standalone Desktop App

A completely **offline** desktop application for viewing and managing course materials. No internet connection required, no server setup needed - just double-click and run!

## 🎯 Features

- ✅ **100% Offline** - Works without internet connection
- ✅ **No Server Required** - Everything runs locally
- ✅ **Portable** - Can run from USB drive
- ✅ **Cross-Platform** - Works on Windows, macOS, and Linux
- ✅ **Exam-Safe** - No external connections, no tracking
- ✅ **PDF Management** - Upload, organize, search, and view PDFs
- ✅ **Split View** - View two PDFs side-by-side
- ✅ **Smart Search** - Find content across all documents
- ✅ **Categorization** - Organize by lectures, notes, exercises, etc.

## 🚀 Quick Start

### For Regular Use (Development Mode)

```bash
npm start
```

This will:
1. Start the internal Express server
2. Launch the Electron window
3. Load your course materials

### Building the Standalone App

#### For macOS:
```bash
npm run build:mac
```
Creates: `dist/Course Materials Viewer.dmg` and `dist/Course Materials Viewer-mac.zip`

#### For Windows:
```bash
npm run build:win
```
Creates:
- `dist/Course Materials Viewer Setup.exe` (installer)
- `dist/Course Materials Viewer.exe` (portable - no install needed!)

#### For Linux:
```bash
npm run build:linux
```
Creates: `dist/Course Materials Viewer.AppImage` and `.deb` package

#### Build for All Platforms:
```bash
npm run build:all
```

## 📦 Using the Built Application

### Windows
1. **Portable Version** (Recommended for exams):
   - Double-click `Course Materials Viewer.exe`
   - No installation required
   - Can run from USB drive
   - Perfect for exam situations

2. **Installer Version**:
   - Run `Course Materials Viewer Setup.exe`
   - Follow installation wizard
   - Desktop shortcut created

### macOS
1. Open the `.dmg` file
2. Drag "Course Materials Viewer" to Applications
3. Double-click to run
4. If you get a security warning: Right-click → Open

### Linux
1. Make the AppImage executable:
   ```bash
   chmod +x Course\ Materials\ Viewer.AppImage
   ```
2. Double-click to run, or:
   ```bash
   ./Course\ Materials\ Viewer.AppImage
   ```

## 📁 File Structure

```
Course Materials Viewer/
├── subjects/           # Your course PDFs (DBS, OS, etc.)
├── data/              # SQLite database and uploads
├── public/            # Web interface files
│   ├── libs/          # Offline Bootstrap & Font Awesome
│   ├── css/
│   └── js/
└── server/            # Express server (runs internally)
```

## 🎓 Perfect for Exams

### Why This App is Exam-Safe:

1. **No Internet Connection Needed**
   - All resources stored locally
   - No CDN dependencies
   - No external API calls

2. **Professional Appearance**
   - Looks like a standard PDF viewer
   - Clean, simple interface
   - No "AI" or "smart search" indicators

3. **Fast & Reliable**
   - Instant startup
   - No loading from servers
   - Works offline completely

4. **Portable**
   - Run from USB stick
   - No installation required (portable version)
   - Bring your entire course library

## 🔧 Development

### Prerequisites
- Node.js 16+ installed
- npm or yarn

### Install Dependencies
```bash
npm install
```

### Run in Development Mode
```bash
npm start
```

### Run Server Only (without Electron)
```bash
npm run server
```
Then open browser to `http://localhost:3000`

### Development Tools
```bash
# Auto-restart server on changes
npm run dev

# Build for current platform
npm run build

# Build for specific platform
npm run build:mac
npm run build:win
npm run build:linux
```

## 🛠️ Troubleshooting

### Port Already in Use
If you get "port 3000 already in use":
```bash
# Find and kill the process (macOS/Linux)
lsof -ti:3000 | xargs kill -9

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### App Won't Start
1. Delete `data/pdf-viewer.db` and restart
2. Check console output: `npm start`
3. Ensure Node.js is installed: `node --version`

### Build Fails
1. Clear build cache:
   ```bash
   rm -rf dist node_modules
   npm install
   npm run build
   ```

2. Check disk space (builds can be 200-500 MB)

### PDFs Not Loading
1. Check that PDFs are in the `subjects/` directory
2. Check file permissions
3. Ensure PDFs are valid (not corrupted)

## 📝 Adding Your Course Materials

1. Place PDFs in the appropriate subject folder:
   ```
   subjects/
   ├── DBS/
   │   ├── notes/
   │   ├── slides/
   │   └── exercises/
   ├── OS/
   └── [YourSubject]/
   ```

2. The app will automatically detect and organize them

3. Or use the Upload feature in the app

## 🔒 Privacy & Security

- **No telemetry** - No data collection
- **No internet** - Completely offline
- **No tracking** - No analytics
- **Local only** - All data stays on your device
- **Open source** - Review the code yourself

## 📊 Technical Details

### Built With:
- **Electron** - Desktop app framework
- **Express.js** - Internal web server
- **SQLite** - Local database
- **Bootstrap 5** - UI framework (bundled locally)
- **Font Awesome** - Icons (bundled locally)

### App Size:
- macOS: ~150 MB
- Windows: ~180 MB
- Linux: ~160 MB

### Requirements:
- **RAM**: 200 MB minimum
- **Disk**: 500 MB (including PDFs)
- **OS**:
  - macOS 10.13+
  - Windows 7+
  - Linux (modern distributions)

## 🎯 Use Cases

### 1. Exam Preparation
- Load all course materials on USB
- Run portable version
- No internet needed
- Professional appearance

### 2. Offline Study
- Airplane mode study
- Library study rooms
- Areas with poor internet

### 3. Presentations
- Show PDFs side-by-side
- Split view for comparisons
- Quick navigation

### 4. Research
- Search across documents
- Cross-reference materials
- Organize by topics

## 📜 License

MIT License - Free to use and modify

## 🤝 Support

For issues or questions:
1. Check troubleshooting section
2. Review console output: `npm start`
3. Check file permissions
4. Verify Node.js version: `node --version`

---

**Made for students, by students** 📚
**Study smarter, not harder** 🎓

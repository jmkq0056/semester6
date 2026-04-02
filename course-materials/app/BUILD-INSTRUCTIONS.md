# 🚀 Quick Build Guide

## For Students: How to Create Your Standalone App

### Step 1: Prepare Your Materials
Place all your PDFs in the `subjects/` folder:
```
subjects/
├── DBS/notes/
├── DBS/slides/
├── OS/notes/
└── [etc...]
```

### Step 2: Build the App

#### **Windows Users** (Portable - Best for Exams!)
```bash
npm run build:win
```
✅ Creates: `dist/Course Materials Viewer.exe` (portable - runs without install!)
✅ Size: ~180 MB
✅ No installation needed - just double-click!

#### **macOS Users**
```bash
npm run build:mac
```
✅ Creates: `dist/Course Materials Viewer.dmg`
✅ Size: ~150 MB
✅ Drag to Applications folder

#### **Linux Users**
```bash
npm run build:linux
```
✅ Creates: `dist/Course Materials Viewer.AppImage`
✅ Make executable: `chmod +x *.AppImage`
✅ Double-click to run

### Step 3: Use Your App!

**Windows:**
- Find `Course Materials Viewer.exe` in the `dist/` folder
- Copy to USB drive or desktop
- Double-click to run
- **NO INTERNET NEEDED!**

**macOS:**
- Open the `.dmg` file
- Drag to Applications
- Done!

**Linux:**
- Run: `chmod +x Course\ Materials\ Viewer.AppImage`
- Double-click or: `./Course\ Materials\ Viewer.AppImage`

---

## 📊 Build Times & Sizes

| Platform | Build Time | App Size | Output |
|----------|-----------|----------|---------|
| **Windows** | 2-5 min | ~180 MB | `.exe` (portable) + Setup |
| **macOS** | 3-6 min | ~150 MB | `.dmg` + `.zip` |
| **Linux** | 2-4 min | ~160 MB | `.AppImage` + `.deb` |

---

## 🎯 For Exams - Best Setup

### **Recommended: Windows Portable**
1. Build: `npm run build:win`
2. Copy `dist/Course Materials Viewer.exe` to USB
3. On exam computer: Double-click to run
4. No installation, no admin rights needed!

### **Why Portable is Best:**
- ✅ No installation required
- ✅ No admin rights needed
- ✅ Run from USB drive
- ✅ Leave no traces
- ✅ Works on any Windows PC
- ✅ Completely offline

---

## 🔧 Troubleshooting

### "Out of Memory" During Build
- Close other apps
- Increase Node memory:
  ```bash
  export NODE_OPTIONS=--max_old_space_size=4096
  npm run build:win
  ```

### Build is Slow
- First build is always slow (downloads Electron)
- Subsequent builds are faster
- Use `npm run build` (current platform only)

### Missing Icons
- Icons are optional
- App will use default Electron icon
- Custom icon: Place in `build/icon.png`

---

## 📦 What Gets Included

Your built app includes:
- ✅ All your PDFs (`subjects/` folder)
- ✅ Database (viewing history, etc.)
- ✅ Express server (runs internally)
- ✅ Web interface (Bootstrap, Font Awesome - offline!)
- ✅ Node.js runtime (embedded)
- ✅ SQLite database

**Everything runs offline!**

---

## 🎓 Usage Tips

### Before Exam:
1. Build the app
2. Test it works offline (turn off WiFi!)
3. Copy to USB drive
4. Test on another computer

### During Exam:
1. Plug in USB
2. Double-click app
3. Wait 2-3 seconds for startup
4. Use normally!

### After Exam:
- App can be deleted
- Or keep for future study!

---

## 🆘 Quick Fixes

**App won't start?**
- Check: Is port 3000 free?
- Try: Restart computer

**PDFs not showing?**
- Check: Are PDFs in `subjects/` folder?
- Try: Rebuild the app

**Looks suspicious?**
- Remember: It's just a PDF viewer!
- Professional, clean interface
- No "smart" or "AI" branding

---

## 💡 Pro Tips

1. **Test offline before exam**
   - Turn off WiFi
   - Verify all PDFs load
   - Test search feature

2. **Keep backups**
   - Save built `.exe` separately
   - Keep USB copy
   - Have desktop copy

3. **Quick startup**
   - First launch takes 3-5 seconds
   - Subsequent launches: 1-2 seconds

4. **Portable advantage**
   - No traces left on computer
   - Runs in temp directory
   - Clean exit

---

**Ready to build?**
```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

**Then find your app in the `dist/` folder! 🎉**

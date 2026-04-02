## 🧪 Testing Steps - Page Navigation Fix

### Step 1: Test Direct DOM Manipulation
```
Open: http://localhost:3000/debug-click.html
```
- Click "Test Page 5" button
- **Expected:** PDF loads and shows page 5 immediately
- **Check:** Look at page number in Chrome's PDF toolbar (top right)

### Step 2: Test Smart Search (HARD REFRESH FIRST!)
```
1. Open: http://localhost:3000
2. Press: Cmd+Shift+R (hard refresh to clear cache)
3. Click: "Smart Search" button
4. Wait: For indexing to complete
5. Search: "machine" or "learning"
6. Click: Any page number in results
```

**Expected Result:**
- Search panel closes
- PDF modal opens
- Title shows: "Document Name (Page X)"
- PDF displays at that exact page

### Step 3: Check Browser Console
```
1. Right-click → Inspect
2. Go to Console tab
3. Click a search result
4. Look for these logs:
   ✅ "Opening PDF at page: X"
   ✅ "Path with fragment: /path/to/file.pdf#page=X"
   ✅ "PDF opened successfully with page fragment"
```

### Troubleshooting:

**If nothing happens:**
1. Check console for errors
2. Make sure `pdfSearchUI` is defined: type `pdfSearchUI` in console
3. Hard refresh: Cmd+Shift+R
4. Clear cache: Chrome Settings → Clear browsing data

**If PDF opens but wrong page:**
1. Check the console logs - does it show correct page number?
2. Check iframe src in Elements tab: `<iframe id="pdf-viewer-left" src="...#page=X">`
3. Try the debug-click.html test first

**If you get errors:**
Share the console error message!

### What Success Looks Like:

✅ Click result for "Page 7"
✅ Console shows: "Opening PDF at page: 7"
✅ Console shows: "Path with fragment: .../file.pdf#page=7"
✅ Modal opens with PDF
✅ Title shows: "Document Name (Page 7)"
✅ PDF displays page 7 content
✅ Chrome's PDF toolbar shows "7" as current page

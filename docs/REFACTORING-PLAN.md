# Refactoring Plan: Course Materials App

**Constraint: Everything must work exactly as-is after each step. No build tools, no bundlers — vanilla JS loaded via `<script>` tags.**

---

## Inventory

| File | Lines | Problem |
|------|------:|---------|
| `public/css/styles.css` | 8,946 | Monolith: navigation + file list + PDF viewer + study panel + 15 slide components + lecture colors |
| `public/js/script.js` | 7,987 | Monolith: PDF viewer + URL routing + study panel + slide parser + history + file mgmt + categories |
| `server/server.js` | 4,247 | Monolith: 50+ API routes across 13 domains in one file |
| `public/js/tex-editor.js` | 3,988 | Large, but real problem is ~1,400 lines duplicated with latex-project.js |
| `public/css/tex-editor.css` | 3,680 | ~800 lines duplicated with latex-project.css |
| `public/css/latex-project.css` | 3,294 | ~800 lines duplicated with tex-editor.css |
| `public/js/latex-project.js` | 2,984 | Large, but real problem is duplication with tex-editor.js |

---

## Execution Order

The plan is ordered so each phase is independently shippable. Complete one phase, verify the app works, then move to the next.

---

## Phase 1: Server-Side Route Extraction

**Why first:** Backend changes are the safest — no DOM, no global state, no HTML dependencies. Express routers are a well-understood pattern.

**Current state:** `server.js` (4,247 lines) contains 50+ routes across 13 domains.

**Target state:** `server.js` becomes a thin orchestrator (~400 lines) that mounts route files.

### Step 1.1 — Extract route files

Create `server/routes/` with one file per domain. Each file exports an Express Router.

```
server/routes/
  subjects.js          ← Lines 600-654: GET/POST/PUT/DELETE /api/subjects, /api/current-subject, /api/set-current-subject
  files.js             ← Lines 419-598: GET /api/files, /api/file-exists, /api/subject-folders, /api/subject-files
  custom-categories.js ← Lines 656-924: GET/POST/PUT/DELETE /api/custom-categories
  upload.js            ← Lines 926-1092: POST /api/upload-pdf (includes filename sanitization)
  file-manager.js      ← Lines 1094-1235: DELETE/POST /api/file, /api/file-manager/*
  history.js           ← Lines 1199-1255: GET/POST/DELETE /api/history, /api/split-companion
  preferences.js       ← Lines 1237-1255: GET/POST /api/preferences
  tex-files.js         ← Lines 1257-1684: GET/PUT/POST /api/tex-content, /api/tex-info, /api/compile-tex, /api/create-tex, /api/check-latex
  tex-versions.js      ← Lines 1934-2221: GET/POST /api/tex-versions/*, /api/tex-history/*
  claude-edit.js       ← Lines 2223-3040: POST /api/claude-edit, /api/claude-edit/stop, /api/claude-edit/revert (SSE streaming)
  claude-chat.js       ← Lines 3042-3788: POST /api/ask-claude, /api/study-claude, /api/chat-history
  claude-slides.js     ← Lines 470-598: GET/POST/PUT/DELETE /api/slides
  media.js             ← Lines 3822-4234: POST /api/extract-pdf-pages, /api/youtube-transcript, /api/generate-intuition-image
```

### Step 1.2 — Extract shared utilities

Create `server/utils/`:

```
server/utils/
  file-scanner.js      ← scanDirectory(), scanSubjectDirectory(), categorizePDFs(),
                          formatFileName(), extractLectureNumber(), naturalSort()  (Lines 122-413)
  compilation-lock.js  ← CompilationLock class (Lines 27-67)
  claude-helpers.js    ← parseSearchReplaceBlocks(), applySearchReplaceBlocks(),
                          parseMultiSelectionOutput(), createBackups()  (Lines 2229-2462)
```

### Step 1.3 — Slim down server.js

After extraction, `server.js` becomes:

```js
// server.js (~100 lines)
const express = require('express');
const app = express();
const db = require('./database');

// Middleware
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.use('/subjects', express.static(SUBJECTS_DIR));
// ... other static mounts

// Mount route files
app.use('/api', require('./routes/subjects'));
app.use('/api', require('./routes/files'));
app.use('/api', require('./routes/custom-categories'));
// ... etc

// HTML pages
app.get('/history', ...);
app.get('*', ...);

module.exports = app;
```

### How to verify

Run the app, click through every page, open PDFs, use split view, upload a file, compile LaTeX, use Claude edit. Every API call hits the same endpoints — just from different files.

---

## Phase 2: Extract Shared Claude Module (JS)

**Why second:** tex-editor.js and latex-project.js share ~1,400 lines of nearly identical Claude AI integration code. This is the single largest duplication in the codebase.

**Duplicated functions (present in both files with near-identical logic):**

| Function | Purpose |
|----------|---------|
| `setClaudeMode()` | Switch file/selection mode |
| `autoDetectClaudeMode()` | Auto-detect from editor selection |
| `addCurrentSelection()` | Add code selection |
| `removeCodeSelection()` | Remove selection |
| `clearAllCodeSelections()` | Clear all |
| `renderCodeSelections()` | Render selection chips |
| `handleClaudePaste()` | Paste image/YouTube detection |
| `addClaudeImage()` / `removeClaudeImage()` | Image attachments |
| `renderClaudeImagePreviews()` | Image preview UI |
| `addAIMessage()` / `clearAIMessages()` | Message management |
| `updateAIProgress()` / `clearAIProgress()` | Progress indicators |
| `appendLiveToAIPanel()` / `clearLiveOutput()` | Streaming output |
| `showFileAutocomplete()` / `hideAutocomplete()` | File picker |
| `updateAutocompleteSelection()` | Keyboard nav |
| `selectAutocompleteFile()` | Select file |
| `removeReferencedFile()` | Remove reference |
| `runClaudeAction()` | Main SSE action handler |
| `showClaudeSpinner()` / `hideClaudeSpinner()` | Loading state |
| `resetClaudeState()` | State reset |
| `showClaudeTerminal()` / `closeClaudeTerminal()` | Terminal panel |
| `appendClaudeOutput()` / `clearClaudeTerminal()` | Terminal output |
| `stopClaudeProcess()` | Cancel running process |
| `showClaudeReviewPanel()` | Review UI |
| `showTextDiff()` / `closeTextDiff()` | Diff viewer |
| YouTube transcript functions | YouTube references |

### Step 2.1 — Create `public/js/claude-integration.js`

This module takes a **config object** so it can work in both contexts:

```js
// claude-integration.js
//
// Shared Claude AI integration for both tex-editor and latex-project.
// Usage:
//   const claude = createClaudeIntegration({
//     getEditor: () => texEditor,        // returns CodeMirror instance
//     getFilePath: () => currentTexFile.path,
//     panelSelector: '#claude-ai-panel', // or '#claude-panel'
//     terminalSelector: '#claude-terminal',
//     loadFiles: async () => { ... },    // load available files for autocomplete
//     onFileModified: (content) => { ... }, // callback when Claude edits a file
//     onCompileNeeded: () => { ... },     // callback to trigger compilation
//   });
```

State variables (`claudeMode`, `claudeCodeSelections`, `claudePastedImages`, `claudeEditState`, `claudeEditBackup`, `claudeReferencedFiles`, `claudeYoutubeTranscripts`) move into the module's closure — no more globals.

### Step 2.2 — Update tex-editor.js

Replace ~1,400 lines of Claude code with:

```js
const texClaudeIntegration = createClaudeIntegration({
    getEditor: () => texEditor,
    getFilePath: () => currentTexFile?.path,
    // ... config
});
```

Expose needed functions to `window` by delegating:

```js
window.runClaudeAction = (action) => texClaudeIntegration.runAction(action);
// etc.
```

### Step 2.3 — Update latex-project.js

Same pattern — replace ~1,400 lines with a `createClaudeIntegration()` call using project-specific config.

### Step 2.4 — Update HTML script loading

In `index.html`: add `<script src="js/claude-integration.js"></script>` before `tex-editor.js`.

In `latex.html`: add `<script src="js/claude-integration.js"></script>` before `latex-project.js`.

### Net result

| File | Before | After | Change |
|------|-------:|------:|--------|
| `tex-editor.js` | 3,988 | ~2,500 | -1,488 |
| `latex-project.js` | 2,984 | ~1,500 | -1,484 |
| `claude-integration.js` | 0 | ~1,600 | new (shared) |
| **Total** | 6,972 | ~5,600 | -1,372 (deduplication) |

### How to verify

Open index.html, open a .tex file, use Claude edit (all modes: file, selection, custom prompt, image paste, YouTube reference). Then open latex.html, open a project, repeat all Claude operations. Both must work identically.

---

## Phase 3: Split script.js

**Why third:** This is the largest and most complex file. The section analysis revealed clear domain boundaries but heavy cross-dependencies between URL routing and PDF viewing.

**Current structure (7,987 lines):**

```
Lines 1-23:       Global state
Lines 25-46:      Keyboard input protection
Lines 49-193:     History management
Lines 196-1007:   URL routing & state management
Lines 1010-1309:  PDF structure loading & file list
Lines 1309-1741:  Filtering & search
Lines 1768-2704:  PDF viewer core + split view
Lines 2744-3195:  File management + custom categories
Lines 3240-3336:  Modal management + page init
Lines 3338-3444:  Category manager modal
Lines 3532-3605:  File selection (disabled)
Lines 3978-5250:  Study with Claude panel
Lines 5417-5800:  Slide component parser
Lines 5563-5639:  Intuition image generation
Lines 6000+:      Code tracer
Lines 6407-6583:  Versus/flashcard components
Lines 6959-7278:  Step visualizer
Lines 7544-7988:  Slide presentation mode
```

### Step 3.1 — Extract slide components (zero risk)

Create `public/js/slide-components.js` (~2,000 lines):

- `parseSlideComponents(text)` — the regex parser
- `renderStudyContent(text)` — main rendering pipeline
- `processInlineMarkdown(text)` — inline markdown handler
- All component interaction functions:
  - `flipFlashcard()`, `copySlideCode()`
  - `versusHighlight()`, `versusUnhighlight()`, `versusReveal()`
  - `queueIntuitionImageGeneration()`, `processIntuitionImageQueue()`
  - Code tracer state + modal handlers
  - Step visualizer (`stepVizNext`, `stepVizPrev`, `stepVizTogglePlay`, `initStepVisualizers`, `cleanupStepVisualizers`, etc.)
- All related global state: `intuitionImageQueue`, `isGeneratingIntuitionImage`, `stepVizStates`, `traceStates`, `activeTraceModal`

**Why zero risk:** These functions are called from dynamically generated HTML (innerHTML from Claude responses) and from the slide presentation code. They just need to be global (`window.*`), which they already are.

### Step 3.2 — Extract study panel

Create `public/js/study-panel.js` (~1,300 lines):

- `initializeStudyPanel()` — creates overlay DOM
- `openStudyWithClaude()` / `closeStudyPanel()` / `minimizeStudyPanel()`
- `clearStudyChat()`, `sendStudyMessage()`
- `loadStudySubjectFiles()`, `loadStudyHistory()`
- File reference management (`addStudyFileReference`, `openStudyFileSelector`, etc.)
- YouTube reference handling
- Image handling (`addStudyImageToMessage`, `handleStudyPaste`)
- Tab switching (`switchStudyTab`)
- `renderStudyMessages()` — calls `renderStudyContent()` from slide-components.js
- All related state: `studyPanelOpen`, `studyReferencedFiles`, `studyMessages`, `studyCurrentDocument`, etc.

**Dependencies:**
- Reads `currentLeftPDF`, `currentTexFile` from script.js globals (read-only, safe)
- Calls `renderStudyContent()` from slide-components.js
- Calls `initStepVisualizers()` from slide-components.js

### Step 3.3 — Extract slide presentation

Create `public/js/slide-presentation.js` (~500 lines):

- `viewSlidesFullscreen()` / `exitSlideView()`
- `nextSlide()` / `prevSlide()` / `goToSlide()`
- `handleSlideKeydown()`
- `toggleSlideFullscreen()`
- Slide state: `slidesData`, `currentSlideIndex`, `activeViz`

**Dependencies:**
- Calls `renderMermaidDiagrams()`, `initStepVisualizers()`, `cleanupStepVisualizers()` from slide-components.js

### Step 3.4 — What stays in script.js

After extraction, script.js contains the tightly coupled core (~3,200 lines):

```
Global state & keyboard protection       ~50 lines
History management                        ~150 lines
URL routing & state management            ~810 lines
PDF structure loading & file list         ~300 lines
Filtering & search                        ~430 lines
PDF viewer core + split view              ~940 lines
File management + custom categories       ~450 lines
Modal management + page initialization    ~100 lines
```

These sections share heavy bidirectional dependencies (URL routing <-> PDF viewer <-> filtering <-> file list) and splitting them further would require an event bus or state manager — too risky for a "keep it working" refactor.

### Step 3.5 — Update index.html script loading order

```html
<!-- Before script.js -->
<script src="js/slide-components.js"></script>
<script src="js/study-panel.js"></script>
<script src="js/slide-presentation.js"></script>
<script src="js/claude-integration.js"></script>
<!-- Existing -->
<script src="js/script.js"></script>
<script src="js/tex-editor.js"></script>
<!-- ... rest stays the same -->
```

Order matters: slide-components must load before study-panel and slide-presentation (they call its functions). All must load before script.js (which calls `initializeStudyPanel` on DOMContentLoaded).

Actually — since these are all global functions, load order only matters if one file's top-level code calls another. All the cross-calls happen inside functions triggered by user actions or DOMContentLoaded events, so order is flexible. But the above order is safest.

### Net result

| File | Before | After |
|------|-------:|------:|
| `script.js` | 7,987 | ~3,200 |
| `slide-components.js` | — | ~2,000 |
| `study-panel.js` | — | ~1,300 |
| `slide-presentation.js` | — | ~500 |

### How to verify

1. Load index.html — file list, filtering, sidebar all work
2. Open a PDF — viewer, split view, replace, hide/show panes
3. Use browser back/forward — URL routing works
4. Open Study with Claude — panel opens, send message, components render
5. View slides fullscreen — navigation, step visualizer, flashcards, code tracer all work
6. Open a .tex file — editor works (tex-editor.js unchanged in this phase)

---

## Phase 4: Split styles.css

**Current:** 8,946 lines in one file.

### Step 4.1 — Extract study & slide component styles

Create `public/css/study-panel.css` (~3,000 lines):

- Study with Claude overlay (lines 4647-7597)
- All slide components: definition, example, keypoint, formula, code, steps, flashcard, quiz, summary, versus, mermaid, plain-english, intuition-image, code-tracer (lines 5958-8900)
- Slide navigation and presentation mode (lines 7255-7440)

### Step 4.2 — Extract Claude chat bubble styles

Create `public/css/claude-chat.css` (~350 lines):

- Chat bubble floating interface (lines 4312-4645)

### Step 4.3 — Extract file management styles

Create `public/css/file-management.css` (~900 lines):

- File manager selection/operations (lines 2778-3032)
- Rename modal (lines 3033-3201)
- File popover (lines 3202-3509)
- File preview & form sections (lines 3510-3886)
- Category dialog & manager (lines 3887-4309)
- Delete confirmation (lines 8902-8925)

### Step 4.4 — What stays in styles.css

After extraction (~4,700 lines):

```
Root variables & body           ~80 lines
Toolbar & breadcrumb            ~350 lines
Sidebar & lecture colors        ~650 lines
History section                 ~350 lines
File list                       ~175 lines
PDF modal viewer                ~700 lines
PDF selector sidebar            ~330 lines
Scrollbars & responsive         ~70 lines
Subject management              ~720 lines
Bootstrap modal overrides       ~300 lines
Subject dropdown                ~250 lines
TeX file row styling            ~20 lines
```

### Step 4.5 — Update index.html

```html
<link rel="stylesheet" href="css/styles.css">
<!-- ... existing CodeMirror/tex-editor CSS ... -->
<link rel="stylesheet" href="css/claude-chat.css">
<link rel="stylesheet" href="css/study-panel.css">
<link rel="stylesheet" href="css/file-management.css">
```

### How to verify

Every visual element must look identical. Check:
- Home page layout, sidebar, toolbar, breadcrumb
- PDF viewer modal, split view, selector
- File management popover, rename, delete modals
- Category creation/manager modals
- Study panel, all slide components
- Chat bubble
- History page
- Subjects page
- Upload page

---

## Phase 5: Deduplicate Claude CSS

**Why:** tex-editor.css and latex-project.css share ~800 lines of identical Claude/terminal/diff/review styles.

### Step 5.1 — Create `public/css/claude-editor-shared.css`

Extract the shared patterns (~800 lines):

- Claude AI panel container, header, mode tabs, selection info
- Quick actions dropdown
- Custom prompt textarea + send button
- File autocomplete dropdown
- Referenced files display
- Image preview
- Terminal panel (container, header, content, line styles: info/success/warning/error)
- Spinner/loading animation
- Diff modal (overlay, content, line highlighting, legend)
- Review buttons (keep/revert/diff)
- Messages area (user/system/success/error)
- Progress indicator
- Live output streaming area
- Code selection chips

### Step 5.2 — Slim down both files

- `tex-editor.css`: Remove shared styles, keep editor-specific (CodeMirror overrides, outline panel, version control panel, compare modal, new tex file modal) → ~2,800 lines
- `latex-project.css`: Remove shared styles, keep project-specific (file tree, tabs, git section, toast notifications, file viewers, YouTube modal) → ~2,400 lines

### Step 5.3 — Update HTML

In `index.html`:
```html
<link rel="stylesheet" href="css/claude-editor-shared.css">
<link rel="stylesheet" href="css/tex-editor.css">
```

In `latex.html`:
```html
<link rel="stylesheet" href="css/claude-editor-shared.css">
<link rel="stylesheet" href="css/tex-editor.css">
<link rel="stylesheet" href="css/latex-project.css">
```

### Net result

| File | Before | After |
|------|-------:|------:|
| `tex-editor.css` | 3,680 | ~2,800 |
| `latex-project.css` | 3,294 | ~2,400 |
| `claude-editor-shared.css` | — | ~800 |
| **Total** | 6,974 | ~6,000 (-974 deduplication) |

---

## Phase 6 (Optional): CSS Variables & Deduplication Within styles.css

This phase addresses internal quality issues without changing file boundaries.

### Step 6.1 — Lecture color loop

Replace 14 repetitive blocks (~200 lines) with a data-attribute approach:

```css
/* Before: 14 blocks like this */
.sidebar-item[onclick*="lecture-1"] .sidebar-icon { color: var(--lecture-1) !important; }
.sidebar-item[onclick*="lecture-2"] .sidebar-icon { color: var(--lecture-2) !important; }
/* ... */

/* After: JS sets data-lecture-color on elements, CSS uses it */
.sidebar-item .sidebar-icon { color: var(--lecture-color) !important; }
```

This requires a tiny JS change: when rendering sidebar items, set `style="--lecture-color: var(--lecture-N)"` instead of relying on `onclick*=` attribute selectors.

### Step 6.2 — Consolidate duplicate patterns

- **Scrollbar styles** (~40 lines duplicated across 6+ components): Extract to a `.custom-scrollbar` utility class
- **Card hover effects** (6 components): Extract to `.hoverable-card` utility class
- **Modal/overlay wrappers** (5 instances): Extract to `.modal-overlay` + `.modal-card` base classes
- **Glass-morphism** (8 instances): Extract to a `--glass-bg` CSS variable
- **Input focus rings** (6 instances): Extract to `.focus-ring` utility class
- **Duplicate keyframe animations** (`fadeIn` appears 2x, `slideUp` appears 2x): Consolidate to single definitions

---

## Summary: Before and After

### JavaScript

| File | Before | After |
|------|-------:|------:|
| `server/server.js` | 4,247 | ~400 |
| `server/routes/*.js` (13 files) | — | ~3,400 |
| `server/utils/*.js` (3 files) | — | ~450 |
| `public/js/script.js` | 7,987 | ~3,200 |
| `public/js/slide-components.js` | — | ~2,000 |
| `public/js/study-panel.js` | — | ~1,300 |
| `public/js/slide-presentation.js` | — | ~500 |
| `public/js/claude-integration.js` | — | ~1,600 |
| `public/js/tex-editor.js` | 3,988 | ~2,500 |
| `public/js/latex-project.js` | 2,984 | ~1,500 |

**Largest file drops from 7,987 to ~3,200 lines. No file exceeds ~3,400 lines.**

### CSS

| File | Before | After |
|------|-------:|------:|
| `public/css/styles.css` | 8,946 | ~4,700 |
| `public/css/study-panel.css` | — | ~3,000 |
| `public/css/claude-chat.css` | — | ~350 |
| `public/css/file-management.css` | — | ~900 |
| `public/css/claude-editor-shared.css` | — | ~800 |
| `public/css/tex-editor.css` | 3,680 | ~2,800 |
| `public/css/latex-project.css` | 3,294 | ~2,400 |

**Largest file drops from 8,946 to ~4,700 lines. No file exceeds ~4,700 lines.**

### Total line count change

| | Before | After | Delta |
|--|-------:|------:|------:|
| JS (the 4 large files) | 19,206 | ~16,850 | -2,356 (deduplication) |
| CSS (the 3 large files) | 15,920 | ~14,950 | -970 (deduplication) |

---

## Risk Assessment

| Phase | Risk | Why |
|-------|------|-----|
| 1 - Server routes | Very Low | Express routers are a standard pattern. Same endpoints, different files. |
| 2 - Shared Claude JS | Low | Both files already have identical interfaces. Config-based factory is straightforward. |
| 3 - Split script.js | Low-Medium | Extracted pieces (slides, study panel) are self-contained. The coupled core (PDF viewer + routing) stays together. |
| 4 - Split styles.css | Very Low | CSS extraction is purely additive — same selectors, just different files. |
| 5 - Shared Claude CSS | Low | Identical styles consolidated. |
| 6 - CSS cleanup | Low | Internal refactoring within files. Utility classes are additive. |

---

## Rules for Execution

1. **One phase at a time.** Verify the app works fully before starting the next phase.
2. **No renames.** Function names, CSS class names, API endpoints, and HTML IDs stay exactly the same.
3. **No logic changes.** Move code between files, never rewrite it.
4. **Test every page.** After each phase: index.html, subjects.html, upload.html, latex.html, history.html.
5. **Test every feature path.** PDF open/close/split, Claude edit, study panel, slide view, file management, LaTeX compile, URL back/forward.
6. **Git commit per phase.** Easy rollback if something breaks.

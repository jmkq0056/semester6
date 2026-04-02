# Plan: Port Claude Integration from tex-editor.js to LaTeX Projects

## Goal
Replicate the fully-functional Claude AI editing experience from `tex-editor.js` to `latex-project.js` with minor adaptations for multi-file project context.

---

## Analysis of tex-editor.js Claude Integration

### Global State Variables (tex-editor.js:44-65)
```javascript
// Claude @ file references
let claudeReferencedFiles = [];      // Referenced files with content
let claudeSubjectFiles = [];         // Available files for autocomplete
let claudeAutocompleteIndex = -1;    // Autocomplete navigation

// Claude AI sidepanel state
let isClaudeAIPanelOpen = false;
let claudePastedImages = [];         // Pasted images as base64
let claudeCodeSelections = [];       // Multiple code selections
let selectionIdCounter = 0;          // Unique ID for selections
let claudeYoutubeTranscripts = [];   // YouTube transcripts

// Edit state machine
const ClaudeEditState = { IDLE, RUNNING, REVIEWING, COMPILING };
let claudeEditState = ClaudeEditState.IDLE;
let isClaudeRunning = false;

// Backup for revert
let claudeEditBackup = {
    originalContent: null,
    originalPdfPath: null,
    backupTexPath: null,
    backupPdfPath: null,
    newPdfPath: null
};
```

### Claude AI Panel HTML Structure (tex-editor.js:221-311)
The panel is created dynamically with:
1. **Header** - Title + close button
2. **Mode Selection Tabs** - "Selection" vs "Entire File"
3. **Code Selections Area** - Shows added code selections as chips
4. **Current Selection Preview** - Shows what's currently selected in editor
5. **Quick Actions Grid** - Improve, Fix, Simplify, Expand, Symbols buttons
6. **Messages Area** - Shows conversation/output
7. **Referenced Files Bar** - Shows @ referenced files + YouTube transcripts
8. **Image Preview Area** - Shows pasted images
9. **Input Area** - Textarea with @ autocomplete + image attach + send button

### Key Functions to Port

#### 1. Panel Toggle & Setup (tex-editor.js:1299-1326)
- `toggleClaudeAIPanel()` - Opens/closes panel, loads files for autocomplete
- Sets up paste handler for images/YouTube URLs

#### 2. Mode Handling (tex-editor.js:1328-1446)
- `setClaudeMode(mode)` - Switches between 'selection' and 'file' modes
- `updateClaudeSelectionInfo()` - Updates UI based on current selection
- `autoDetectClaudeMode()` - Auto-switches based on selections
- `setClaudeModeQuiet(mode)` - Sets mode without triggering full update

#### 3. Code Selections (tex-editor.js:1448-1573)
- `isSelectionAlreadyAdded(from, to)` - Checks for duplicates
- `addCurrentSelection()` - Adds editor selection to list
- `createSelectionPreview(text)` - Creates truncated preview
- `removeCodeSelection(id)` - Removes from list
- `clearAllCodeSelections()` - Clears all
- `renderCodeSelections()` - Renders selection chips

#### 4. @ File Reference Autocomplete (tex-editor.js:2009-2248)
- `loadSubjectFilesForAutocomplete()` - Loads available files
- `showFileAutocomplete(query, isNewPanel)` - Shows dropdown
- `hideAutocomplete()` - Hides dropdown
- `updateAutocompleteSelection(items)` - Keyboard navigation
- `selectAutocompleteFile(filePath)` - Selects file from dropdown
- `addReferencedFile(file)` - Adds to references with content
- `removeReferencedFile(filePath)` - Removes reference
- `updateReferencedFilesDisplay()` - Updates display

#### 5. YouTube Transcripts (tex-editor.js:1724-1911)
- `showTexYouTubeLanguageModal(videoId)` - Language selection modal
- `addTexYouTubeTranscript(videoId, language)` - Fetches transcript
- `renderTexYoutubeRefs()` - Renders YouTube chips
- `removeTexYoutubeRef(videoId)` - Removes transcript

#### 6. Image Handling (tex-editor.js:1642-1722)
- `handleClaudePaste(event)` - Handles paste for images/YouTube
- `handleClaudeImageSelect(event)` - File input handler
- `addClaudeImage(file)` - Converts to base64
- `renderClaudeImagePreviews()` - Renders image thumbnails
- `removeClaudeImage(index)` - Removes image

#### 7. AI Messages/Output (tex-editor.js:1913-2007)
- `addAIMessage(text, type, images)` - Adds message to chat
- `clearAIMessages()` - Clears messages
- `updateAIProgress(text)` - Shows progress indicator
- `clearAIProgress()` - Removes progress
- `appendLiveToAIPanel(text)` - Real-time streaming output

#### 8. Main Action Handler (tex-editor.js:2256-2480)
`runClaudeAction(action)`:
1. Validates state and mode
2. Gets custom prompt if needed
3. Collects all context (selections, files, images, transcripts)
4. Creates backup for revert
5. Shows terminal panel
6. Sends to `/api/claude-edit` endpoint with:
   - texPath
   - codeSelections (if selection mode)
   - action
   - customPrompt
   - fullContent
   - editMode
   - referencedFiles
   - youtubeTranscripts
   - images
7. Handles SSE stream response

#### 9. SSE Message Handler (tex-editor.js:2481-2600+)
`handleClaudeSSEMessage(data)`:
- Handles different message types: output, progress, file_written, compile_start, compile_done, error, etc.
- Updates editor content
- Triggers compilation
- Shows review buttons (Accept/Reject)

#### 10. Accept/Reject (tex-editor.js:2600+)
- `acceptClaudeChanges()` - Accepts and saves version
- `rejectClaudeChanges()` - Reverts to backup
- Handles state transitions

---

## Current Issues with latex-project.js

### 1. Panel Not Visible
- The CSS class `.claude-panel.open` or `.claude-panel.visible` isn't being applied correctly
- Check: `latex-project.css` needs `.claude-panel.visible { right: 0; }` (currently has this)
- Check: `toggleClaudePanel()` uses `.toggle('open')` but CSS expects `.visible`

### 2. Missing Core Functionality
The current implementation is shallow:
- No proper state machine
- No code selections with visual chips
- No @ file autocomplete
- Partial YouTube/image support
- Using wrong endpoint (`/api/claude-edit-stream` vs `/api/claude-edit`)
- No backup/revert system
- No SSE message handling matching tex-editor

### 3. Wrong API Endpoint
- tex-editor.js uses: `/api/claude-edit` (SSE streaming)
- latex-project.js uses: `/api/claude-edit-stream` (may not exist)

---

## Implementation Plan

### Phase 1: Fix Panel Visibility
**Files:**
- `latex-project.js:822` - Change `.toggle('open')` to `.toggle('visible')`
- Verify `latex-project.css:578` has correct `.claude-panel.visible` rule

### Phase 2: Port State Variables
**File:** `latex-project.js:10-26`

Add all missing state variables to match tex-editor.js.

### Phase 3: Port Claude Panel HTML
**File:** `latex.html:178-270`

The HTML structure looks correct but verify it matches tex-editor.js panel structure. May need updates to:
- Mode tabs
- Selections area structure
- Quick actions grid
- Messages area
- Input area with autocomplete container

### Phase 4: Port Core Functions
**File:** `latex-project.js` - Add these functions:

1. **Mode Handling** (~100 lines)
   - Port from tex-editor.js:1328-1446

2. **Code Selections** (~150 lines)
   - Port from tex-editor.js:1448-1573

3. **@ Autocomplete** (~200 lines)
   - Port from tex-editor.js:2009-2248
   - **ADAPT**: Use project files instead of subject files
   - Change `loadSubjectFilesForAutocomplete()` to `loadProjectFilesForAutocomplete()`
   - Use `/api/latex-projects/${projectId}/files` endpoint

4. **YouTube Transcripts** (~150 lines) - Already partially done
   - Verify matches tex-editor.js:1724-1911

5. **Image Handling** (~80 lines) - Already partially done
   - Verify matches tex-editor.js:1642-1722

6. **AI Messages** (~100 lines)
   - Port from tex-editor.js:1913-2007

7. **Main Action Handler** (~200 lines)
   - Port from tex-editor.js:2256-2480
   - **ADAPT**: Change `texPath` to project-relative path
   - Use same `/api/claude-edit` endpoint

8. **SSE Handler** (~150 lines)
   - Port from tex-editor.js:2481-2600
   - Handles all message types

9. **Accept/Reject** (~100 lines)
   - Port from tex-editor.js:2600+

### Phase 5: Adapt for Project Context
Key differences:
1. File references come from project, not subject
2. File paths are relative to project root
3. Compilation uses project compile endpoint
4. May edit multiple files (future enhancement)

### Phase 6: Test & Debug
1. Test panel opens/closes
2. Test mode switching
3. Test code selections
4. Test @ autocomplete with project files
5. Test YouTube paste + transcript fetch
6. Test image paste
7. Test quick actions
8. Test custom prompt
9. Test accept/reject
10. Test compilation after edit

---

## Exact Function Locations in tex-editor.js

### Core Claude Functions (MUST PORT)
| Function | Line | Purpose |
|----------|------|---------|
| `toggleClaudeAIPanel()` | 1300 | Open/close panel |
| `setClaudeMode(mode)` | 1329 | Switch selection/file mode |
| `updateClaudeSelectionInfo()` | 1348 | Update selection preview |
| `autoDetectClaudeMode()` | 1415 | Auto-switch based on selections |
| `setClaudeModeQuiet(mode)` | 1433 | Silent mode switch |
| `isSelectionAlreadyAdded()` | 1449 | Check duplicate selections |
| `addCurrentSelection()` | 1459 | Add selection to list |
| `createSelectionPreview()` | 1496 | Create preview text |
| `removeCodeSelection(id)` | 1502 | Remove selection |
| `clearAllCodeSelections()` | 1518 | Clear all selections |
| `renderCodeSelections()` | 1525 | Render selection chips |

### Input Handling (MUST PORT)
| Function | Line | Purpose |
|----------|------|---------|
| `handleClaudeAIKeydown()` | 1581 | Keyboard nav in autocomplete |
| `handleClaudeAIInputChange()` | 1619 | @ detection, auto-resize |

### Image/Paste (PARTIALLY DONE)
| Function | Line | Purpose |
|----------|------|---------|
| `handleClaudePaste()` | 1643 | Detect images/YouTube URLs |
| `handleClaudeImageSelect()` | 1672 | File input handler |
| `addClaudeImage()` | 1682 | Convert to base64 |
| `renderClaudeImagePreviews()` | 1697 | Show thumbnails |
| `removeClaudeImage()` | 1719 | Remove image |

### YouTube (PARTIALLY DONE)
| Function | Line | Purpose |
|----------|------|---------|
| `showTexYouTubeLanguageModal()` | 1729 | Language selection modal |
| `addTexYouTubeTranscript()` | 1787 | Fetch transcript via API |
| `renderTexYoutubeRefs()` | 1855 | Render YouTube chips |
| `removeTexYoutubeRef()` | 1908 | Remove transcript |

### AI Messages/Output (MUST PORT)
| Function | Line | Purpose |
|----------|------|---------|
| `addAIMessage()` | 1918 | Add message to chat area |
| `clearAIMessages()` | 1947 | Clear messages |
| `updateAIProgress()` | 1960 | Show spinner/progress |
| `clearAIProgress()` | 1982 | Remove progress |
| `appendLiveToAIPanel()` | 1988 | Stream real-time output |
| `clearLiveOutput()` | 2034 | Clear live output |

### @ File Autocomplete (MUST PORT + ADAPT)
| Function | Line | Purpose |
|----------|------|---------|
| `loadSubjectFilesForAutocomplete()` | 2040 | Load files -> **ADAPT for project** |
| `showFileAutocomplete()` | 2061 | Show dropdown |
| `hideAutocomplete()` | 2090 | Hide dropdown |
| `updateAutocompleteSelection()` | 2105 | Keyboard navigation |
| `selectAutocompleteFile()` | 2115 | Select from dropdown |
| `updateReferencedFilesDisplay()` | 2159 | Update refs bar |
| `removeReferencedFile()` | 2250 | Remove reference |

### Main Action Handler (MUST PORT + ADAPT)
| Function | Line | Purpose |
|----------|------|---------|
| `runClaudeAction()` | 2256 | Main entry point - sends to API |
| `handleClaudeSSEMessage()` | 2463 | Handle streaming response |

### Terminal/Output (MUST PORT)
| Function | Line | Purpose |
|----------|------|---------|
| `showClaudeSpinner()` | 2609 | Show spinner |
| `hideClaudeSpinner()` | 2632 | Hide spinner |
| `updateClaudeProgress()` | 2640 | Update progress message |
| `resetClaudeState()` | 2653 | Reset to idle |
| `showClaudeTerminal()` | 2660 | Show terminal panel |
| `closeClaudeTerminal()` | 2670 | Close terminal |
| `clearClaudeTerminal()` | 2680 | Clear terminal |
| `appendClaudeOutput()` | 2689 | Append to terminal |
| `updateClaudeStopButton()` | 2716 | Show/hide stop button |
| `stopClaudeProcess()` | 2724 | Stop running process |

### Review/Accept/Reject (MUST PORT)
| Function | Line | Purpose |
|----------|------|---------|
| `showClaudeReviewPanel()` | 2809 | Show accept/reject UI |
| `keepClaudeChanges()` | 3261 | Accept changes |
| `revertClaudeChanges()` | 3288 | Reject and revert |

---

## CRITICAL FIRST FIX

**Issue:** Panel uses `.toggle('open')` but CSS uses `.visible`

**File:** `latex-project.js:824`
```javascript
// Current (WRONG):
panel.classList.toggle('open');

// Should be:
panel.classList.toggle('visible');
```

**File:** `latex-project.css:578`
```css
.claude-panel.visible {
    right: 0;
}
```
This is correct, but the JS is wrong.

---

## Estimated Lines of Code
- New code to add: ~1200 lines
- Code to adapt: ~200 lines
- Total: ~1400 lines (significant but mostly copy-paste with adaptation)

## Next Steps
1. Read this plan
2. Approve approach
3. Execute phase by phase

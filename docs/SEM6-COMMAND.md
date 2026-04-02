# sem6 — Quick Start Command

Shell command to start the course-materials app. Added to `~/.zshrc` as an alias.

## Usage

| Command | What it does |
|---|---|
| `sem6` | Start server on port 3000, open in default browser |
| `sem6 --f` | Kill Firefox + wipe session, open course materials + claude.ai (two tabs, one window) |
| `sem6 --h` | Tile current Firefox window to left half of screen |
| `sem6 --fh` | Kill Firefox + wipe session, open two tabs, then tile left half |

## What each flag does

### `--f` (kill Firefox)
1. Quits Firefox via AppleScript
2. Force kills any remaining Firefox processes
3. Deletes ALL session restore files across all profiles (`sessionstore.jsonlz4`, `recovery.jsonlz4`, `sessionstore-backups/`, etc.)
4. Opens Firefox fresh with two tabs: `localhost:3000` + `claude.ai`

### `--h` (half-half tiling)
- Moves the Firefox window to the left half of the screen
- If there's a second Firefox window, puts it on the right half

### `--fh` (both)
- Does `--f` first, then `--h`

## All runs do this
1. Kill anything on port 3000
2. Start `node server.js` in background
3. Wait for server to be ready (polls up to 6 seconds)
4. Open browser

## Files
- Script: `~/Documents/GitHub/Semester6/sem6.sh`
- Alias in `~/.zshrc`: `alias sem6='bash ~/Documents/GitHub/Semester6/sem6.sh'`
- Server logs: `course-materials/app/backend.log`

## Stop the server
```bash
kill <PID>    # PID is printed when sem6 starts
# or
lsof -ti:3000 | xargs kill -9
```

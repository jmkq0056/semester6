#!/bin/bash
# sem6 — kill, restart, and open the course-materials app
#
#   sem6        → start server, open course materials in default browser
#   sem6 --f    → kill Firefox, wipe session, open course materials + claude.ai (two tabs, one window)
#   sem6 --h    → tile current Firefox windows left/right half-half
#   sem6 --fh   → kill Firefox, wipe session, open TWO windows tiled half-half

PORT=3000
APP_DIR="$HOME/Documents/GitHub/Semester6/course-materials/app"

DO_KILL=false
DO_HALF=false

for arg in "$@"; do
    case "$arg" in
        --fh) DO_KILL=true; DO_HALF=true ;;
        --f)  DO_KILL=true ;;
        --h)  DO_HALF=true ;;
    esac
done

# ── Kill Firefox + wipe session ─────────────────────────────────────────
if $DO_KILL; then
    osascript -e 'tell application "Firefox" to quit' 2>/dev/null
    sleep 1.5
    pkill -9 -f "[Ff]irefox" 2>/dev/null
    sleep 0.5

    for profile in "$HOME/Library/Application Support/Firefox/Profiles/"*; do
        if [[ -d "$profile" ]]; then
            rm -f "$profile/sessionstore.jsonlz4" 2>/dev/null
            rm -f "$profile/sessionstore.js" 2>/dev/null
            rm -rf "$profile/sessionstore-backups" 2>/dev/null
            rm -f "$profile/recovery.jsonlz4" 2>/dev/null
            rm -f "$profile/recovery.baklz4" 2>/dev/null
            rm -f "$profile/previous.jsonlz4" 2>/dev/null
        fi
    done
    echo "Firefox killed + session wiped"
fi

# ── Kill port + start server ────────────────────────────────────────────
lsof -ti:$PORT | xargs kill -9 2>/dev/null
sleep 0.5

cd "$APP_DIR/server"
node server.js > "$APP_DIR/backend.log" 2>&1 &
PID=$!

for i in {1..20}; do
    curl -s "http://localhost:$PORT" >/dev/null 2>&1 && break
    sleep 0.3
done

# ── Open browser ────────────────────────────────────────────────────────
if $DO_KILL && $DO_HALF; then
    # --fh: two SEPARATE windows, will tile after
    /Applications/Firefox.app/Contents/MacOS/firefox --new-window "http://localhost:$PORT" &>/dev/null &
    sleep 2.5
    /Applications/Firefox.app/Contents/MacOS/firefox --new-window "https://claude.ai" &>/dev/null &
    sleep 2.5
elif $DO_KILL; then
    # --f: one window, two tabs
    /Applications/Firefox.app/Contents/MacOS/firefox --new-window "http://localhost:$PORT" &>/dev/null &
    sleep 2.5
    /Applications/Firefox.app/Contents/MacOS/firefox "https://claude.ai" &>/dev/null &
    sleep 1.5
else
    open "http://localhost:$PORT"
fi

# ── Half-half tiling ────────────────────────────────────────────────────
if $DO_HALF; then
    sleep 1
    osascript <<'EOF'
tell application "Firefox" to activate
delay 0.5
tell application "System Events"
    tell process "Firefox"
        if (count of windows) < 2 then return

        -- Get actual desktop size (logical pixels, handles Retina correctly)
        tell application "Finder" to set {x1, y1, sw, sh} to bounds of window of desktop
        set halfW to (sw / 2) as integer
        set mb to 25

        -- Course materials (window 2, opened first) → LEFT half
        set position of window 2 to {0, mb}
        delay 0.2
        set size of window 2 to {halfW, sh - mb}
        delay 0.2

        -- Claude.ai (window 1, opened second/frontmost) → RIGHT half
        set position of window 1 to {halfW, mb}
        delay 0.2
        set size of window 1 to {halfW, sh - mb}
    end tell
end tell
EOF
    echo "Tiled half-half"
fi

echo "sem6 running on http://localhost:$PORT (PID $PID)"
echo "Stop: kill $PID"

#!/bin/bash
# ============================================================================
# run.sh - Compile LaTeX project twice, show stats, clean auxiliary files
# Usage: ./run.sh
# ============================================================================

TEX="practice_exam.tex"
PDF="practice_exam.pdf"
LOG="practice_exam.log"
TOC="practice_exam.toc"

# --- Colors (macOS Terminal) ---
BOLD=$'\033[1m'
DIM=$'\033[2m'
RED=$'\033[31m'
GREEN=$'\033[32m'
CYAN=$'\033[36m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

hr()    { echo "${DIM}==========================================================${RESET}"; }
title() { echo "${CYAN}${BOLD}$1${RESET}"; }
good()  { echo "${GREEN}${BOLD}$1${RESET}"; }
warn()  { echo "${RED}${BOLD}$1${RESET}"; }

# --- Preflight checks ---
if [[ ! -f "$TEX" ]]; then
    warn "ERROR: $TEX not found in current directory"
    exit 1
fi

# --- Timer start ---
START=$(date +%s)

hr
title "COMPILING: $TEX"
hr

# --- Pass 1 ---
title "Pass 1/2..."
pdflatex -interaction=nonstopmode "$TEX" > /dev/null 2>&1 || true
good "Pass 1 complete"

# --- Pass 2 ---
title "Pass 2/2..."
pdflatex -interaction=nonstopmode "$TEX" > /dev/null 2>&1 || true
good "Pass 2 complete"

hr

# --- Verify output was created ---
if [[ ! -f "$PDF" ]]; then
    warn "ERROR: $PDF not created! Check $LOG for errors."
    exit 1
fi

# --- Get page count from log ---
PAGES=0
if [[ -f "$LOG" ]]; then
    # Extract page count from "Output written on main.pdf (73 pages, ...)"
    PAGES=$(grep -o "([0-9]* pages" "$LOG" 2>/dev/null | grep -o "[0-9]*" | tail -1) || PAGES=0
fi

# --- Stats from log (before cleanup) ---
WARNINGS=0
OVERFULL=0
UNDERFULL=0
if [[ -f "$LOG" ]]; then
    WARNINGS=$(grep -c "LaTeX Warning:" "$LOG" 2>/dev/null) || WARNINGS=0
    OVERFULL=$(grep -c "Overfull" "$LOG" 2>/dev/null) || OVERFULL=0
    UNDERFULL=$(grep -c "Underfull" "$LOG" 2>/dev/null) || UNDERFULL=0
fi

# --- Display TOC before cleanup ---
if [[ -f "$TOC" ]]; then
    title "TABLE OF CONTENTS"
    echo ""
    # Parse TOC file and display nicely
    while IFS= read -r line; do
        # Extract section type and title
        if [[ $line =~ \\contentsline\ \{section\}\{\\numberline\ \{([^}]*)\}(.+)\}\{([0-9]+)\} ]]; then
            SEC_NUM="${BASH_REMATCH[1]}"
            SEC_TITLE="${BASH_REMATCH[2]}"
            PAGE="${BASH_REMATCH[3]}"
            # Clean up title (remove \textbf, etc.)
            SEC_TITLE=$(echo "$SEC_TITLE" | sed 's/\\textbf{//g; s/}//g; s/\\critical//g; s/\\keyconcept//g; s/\\remember//g')
            echo "${BOLD}${SEC_NUM}${RESET} ${SEC_TITLE} ${DIM}...${RESET} p.${PAGE}"
        elif [[ $line =~ \\contentsline\ \{subsection\}\{\\numberline\ \{([^}]*)\}(.+)\}\{([0-9]+)\} ]]; then
            SEC_NUM="${BASH_REMATCH[1]}"
            SEC_TITLE="${BASH_REMATCH[2]}"
            PAGE="${BASH_REMATCH[3]}"
            SEC_TITLE=$(echo "$SEC_TITLE" | sed 's/\\textbf{//g; s/}//g; s/\\critical//g; s/\\keyconcept//g; s/\\remember//g')
            echo "  ${DIM}${SEC_NUM}${RESET} ${SEC_TITLE} ${DIM}...${RESET} p.${PAGE}"
        fi
    done < "$TOC"
    echo ""
fi

hr

# --- Cleanup auxiliary files ---
title "Cleaning auxiliary files..."
rm -f *.aux *.log *.out *.toc *.lof *.lot *.fls *.fdb_latexmk *.synctex.gz 2>/dev/null || true
good "Cleaned"

hr

# --- Timer end ---
END=$(date +%s)
ELAPSED=$((END - START))

# --- File size ---
PDF_SIZE=$(du -h "$PDF" | cut -f1)

# --- Report ---
title "BUILD COMPLETE"
echo "${DIM}Output:${RESET}  ${BOLD}$PDF${RESET}"
echo "${DIM}Pages:${RESET}   ${BOLD}${PAGES}${RESET}"
echo "${DIM}Size:${RESET}    ${PDF_SIZE}"
echo "${DIM}Time:${RESET}    ${ELAPSED}s"

if (( WARNINGS + OVERFULL + UNDERFULL > 0 )); then
    echo ""
    warn "Warnings detected:"
    echo "  LaTeX Warnings: $WARNINGS"
    echo "  Overfull hbox:  $OVERFULL"
    echo "  Underfull hbox: $UNDERFULL"
fi

hr
good "DONE"
hr

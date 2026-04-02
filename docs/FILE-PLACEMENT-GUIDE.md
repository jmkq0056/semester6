# File Placement & Naming Guide

This document tells AI assistants (and humans) exactly where to put new files and how to name them so they work with the course-materials app and the rest of the repository.

---

## Repository Layout

```
Semester6/
  AC/                          # Raw course materials for Algorithms and Computability
  mtcps/                       # Raw course materials for Models & Tools for CPS
  course-materials/app/        # The course-materials viewer app
    subjects/
      AC/                      # AC files in app-compatible structure
      MTCPS/                   # MTCPS files in app-compatible structure
  docs/                        # This guide and other docs
  misc/                        # Miscellaneous files
```

There are **two places** a course file can live:

| Location | Purpose |
|----------|---------|
| `/{COURSE}/` (e.g. `/AC/`, `/mtcps/`) | **Raw source** -- the original course materials exactly as received from the university. Never modify these. |
| `/course-materials/app/subjects/{CODE}/` | **App copy** -- files reorganized into the structure the viewer app expects. These are what you see in the UI. |

When adding new materials, you must place files in **both** locations:
1. Put the original in the raw course directory (preserving its original name).
2. Copy it into the correct `subjects/{CODE}/{category}/` folder with standardized naming.

---

## Course Codes

| Course | Raw directory | App subject code | Full name |
|--------|--------------|-----------------|-----------|
| AC | `/AC/` | `AC` | Algorithms and Computability |
| MTCPS | `/mtcps/` | `MTCPS` | Models and Tools for Cyber Physical Systems |

If a new course is added, create both a raw directory at the repo root and seed it in `course-materials/app/server/database.js` (see "Adding a New Course" below).

---

## App Directory Structure (subjects/{CODE}/)

Every subject directory has these standard folders:

```
subjects/{CODE}/
  slides/                  # Lecture slides
  exercises/               # Exercises WITH solutions
  exercises-no-solutions/  # Exercise problem sheets (NO solutions)
  notes/                   # Study notes, handwriting guides, cheatsheets
  blueprint/               # Exam blueprints
  teachers-method/         # Teaching methodology docs
```

Custom categories (like MTCPS's `exam/`) are registered in the database and can have any folder name.

---

## File Naming Rules

### Lecture Slides (`slides/`)

**Pattern:** `lec{N}.pdf` or `lec-{N}-{description}.pdf`

- Prefix: `lec` or `lecture` (case-insensitive)
- Number separated by hyphen, underscore, space, or nothing
- Optional description suffix after the number
- Extension: `.pdf`

The scanner extracts lecture numbers using `/(?:lec|lecture|l)[\s-_]*(\d+)/i`, so all of these work:

```
OK:  lec01.pdf, lec2.pdf, lec-1-intro.pdf, lec10.pdf
```

### Exercises With Solutions (`exercises/`)

**Pattern:** `exercise {N} solution.pdf` (preferred)

- Prefix: `exercise` (case-insensitive — `Exercise` and `exercise` both work)
- Number separated by space, underscore, or hyphen (or no separator)
- Suffix: `solution` or `solutions` or `sol`
- Extension: `.pdf`

The scanner extracts the exercise number using `/exercise[\s-_]*(\d+)/i`, so all of these are recognized:

```
OK:  exercise 1 solution.pdf, Exercise 2 sol.pdf, Exercise1_solutions.pdf
OK:  exercise 4 solutions.pdf, Exercise 6 Solutions.pdf
```

### Exercises Without Solutions (`exercises-no-solutions/`)

**Pattern:** `exercise {N}.pdf` (preferred)

- Same prefix rules — case and separator are flexible
- No solution suffix

```
OK:  exercise 1.pdf, Exercise 2.pdf, MTCPS_Exercise1.pdf
```

### Notes (`notes/`)

**Pattern:** `{COURSE-CODE}-{description}.pdf` or `{COURSE-CODE}-{description}.tex`

- Prefix with the course code in uppercase
- Hyphen-separated description (lowercase)
- If notes are per-lecture, put them in subfolders: `notes/L01-topic-name/filename.pdf`

```
GOOD:  AC-handwriting-guide.pdf, MTCPS-study-notes.tex
GOOD:  notes/L01-turing-machines/AC-L01-summary.pdf
BAD:   my notes.pdf, Notes Lecture 1.pdf
```

### Exam Materials (`exam/` -- custom category)

**Pattern:** Flexible — exam files are placed in the `exam/` custom category directory and recognized by folder, not filename pattern.

Current naming in use:

```
OK:  Exam2023.pdf, Exam23-reexam.pdf, Exam24.pdf, Exam25-solutions.pdf
```

Supporting files (UPPAAL XML, Python solvers) can sit alongside the PDFs in the same folder.

### Supporting Files (XML, Python, etc.)

Supporting files (UPPAAL models, solver scripts) go alongside the PDFs they belong to. No strict naming convention, but prefer:

- Lowercase with hyphens: `coffee-machine.xml`, `numerical-solver-2024.py`
- If it's a solution variant, append `-sol`: `coffee-machine-sol.xml`

### LaTeX Source Files

- Same naming as the PDF they produce
- Keep `.aux`, `.log`, `.out` alongside (they're gitignored or harmless)
- Course code prefix is required: `AC-handwriting-guide.tex`

---

## Raw Course Directory Structure

The raw directories mirror how the university distributes materials. Each course can have its own layout:

### AC (`/AC/`)

```
AC/
  course-description.md
  lectures/              # lec01.pdf ... lec07.pdf
  Exercises/             # Numbered subdirectories: 1/, 2/, ...
    {N}/
      exercise {N}.pdf
      exercise {N} solution.pdf
  notes/                 # Study guides
  error-catalog/         # Error tracking (may be empty)
  a4-drafts/             # Exam A4 page drafts (may be empty)
```

### MTCPS (`/mtcps/`)

```
mtcps/
  course-description.md
  lectures/              # lec-1-intro.pdf, lec2.pdf ... lec9.pdf
  Exercises/             # Numbered subdirectories: 1&2/, 3/, 4/, ...
    {N}/
      Exercise {N}.pdf            # Problem sheet
      Exercise {N} solution.pdf   # Solution
      *.xml, *.q                  # UPPAAL models
  prev-exam/
    {YYYY}/
      main/
        Exam{YY}.pdf
        related/                  # Supporting files (XML, Python)
      reexam/                     # Re-exam (same structure)
```

**Do NOT rename files in the raw directories.** They stay as-is. Only the `subjects/{CODE}/` copies get standardized names.

---

## How the App Categorizes Files

The scanner in `server.js` uses **directory name matching** (case-insensitive):

| Directory contains | Category |
|-------------------|----------|
| `teachers-method` or `teacher-method` | Teachers Method |
| `blueprint` | Blueprint |
| `exercises-no-solutions` | Exercises (No Solutions) |
| `exercises` or `exercise` (and filename has `sheet` or `no-sol`) | Exercises (No Solutions) |
| `exercises` or `exercise` | Exercises |
| `slides` or `slide` | Lecture Slides |
| `notes` or `note` | Lecture Notes |
| *(any registered custom category ID)* | Custom Category |
| *(filename contains `slide` or `handout`)* | Lecture Slides (fallback) |
| *(everything else)* | Other Notes (fallback) |

The scanner extracts lecture numbers from filenames using two patterns:
1. Lecture patterns: `/(?:lec|lecture|l)[\s-_]*(\d+)/i` — matches `lec01`, `lecture-3`, `L5`
2. Exercise patterns: `/exercise[\s-_]*(\d+)/i` — matches `exercise 1`, `Exercise_2`, `Exercise1`

This means exercises are automatically grouped with their corresponding lecture (exercise 1 → Lecture 1, etc.).

**Only `.pdf` and `.tex` files are picked up.** XML, Python, Q files are stored alongside for manual access but won't appear in the app's categorized view.

---

## Step-by-Step: Adding a New File

### Example: New lecture slide for AC (Lecture 8)

1. **Raw directory:** Save the original as `/AC/lectures/lec08.pdf`
2. **App directory:** Copy to `/course-materials/app/subjects/AC/slides/lec08.pdf`

### Example: New exercise for MTCPS (Exercise 10)

1. **Raw directory:** Save originals in `/mtcps/Exercises/10/`
   - `Exercise 10.pdf` (problem)
   - `Exercise 10 solutions.pdf` (solution)
   - Any UPPAAL models as-is
2. **App directory:**
   - `/course-materials/app/subjects/MTCPS/exercises-no-solutions/exercise 10.pdf`
   - `/course-materials/app/subjects/MTCPS/exercises/exercise 10 solution.pdf`
   - XML files go in `/course-materials/app/subjects/MTCPS/exercises/`

### Example: New past exam for MTCPS (2026)

1. **Raw directory:** `/mtcps/prev-exam/2026/main/Exam26.pdf` (and `related/` folder)
2. **App directory:** `/course-materials/app/subjects/MTCPS/exam/exam-2026-main.pdf`

---

## Adding a New Course

1. Create the raw directory at repo root (e.g. `/NewCourse/`)
2. Add a `course-description.md` in it
3. Create the subject in `course-materials/app/server/database.js` -- add an INSERT statement in the `initializeDatabase()` function alongside AC and MTCPS:
   ```js
   db.prepare(`
       INSERT INTO subjects (name, code, semester, color, icon)
       VALUES (?, ?, ?, ?, ?)
   `).run('Course Name', 'CODE', 'Spring 2026', '#color', 'fa-icon');
   ```
4. Create the directory structure: `subjects/{CODE}/{slides,exercises,exercises-no-solutions,notes,blueprint,teachers-method}/`
5. Copy and rename files following the naming rules above
6. If the course needs custom categories (like `exam`), register them:
   ```js
   db.prepare(`
       INSERT INTO custom_categories (subject_code, category_name, category_id, icon, color)
       VALUES (?, ?, ?, ?, ?)
   `).run('CODE', 'Display Name', 'folder-name', 'fa-icon', '#color');
   ```
7. Delete the database file (`app/data/pdf-viewer.db`) so it re-seeds on next launch

---

## Quick Reference Table

| What you have | Raw location | App location | App filename |
|--------------|-------------|-------------|-------------|
| Lecture slide N | `{course}/lectures/` | `subjects/{CODE}/slides/` | `lec{NN}.pdf` |
| Exercise N (problem) | `{course}/Exercises/{N}/` | `subjects/{CODE}/exercises-no-solutions/` | `exercise {N}.pdf` |
| Exercise N (solution) | `{course}/Exercises/{N}/` | `subjects/{CODE}/exercises/` | `exercise {N} solution.pdf` |
| Study notes | `{course}/notes/` | `subjects/{CODE}/notes/` | `{CODE}-{description}.pdf` |
| Past exam | `{course}/prev-exam/{YYYY}/` | `subjects/{CODE}/exam/` | `exam-{YYYY}-{type}.pdf` |
| UPPAAL model | alongside exercise | `subjects/{CODE}/exercises/` | lowercase-with-hyphens `.xml` |
| Blueprint | -- | `subjects/{CODE}/blueprint/` | descriptive name `.pdf` |
| Cheatsheet (LaTeX) | `{course}/notes/` | `subjects/{CODE}/notes/` | `{CODE}-{topic}.tex` |

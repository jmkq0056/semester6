# Semester 6 Study Plan

---

## Part 1: Learning Strategy Audit — How You Studied in Semester 5

### DBS (Database Systems) — Grade: 10 (B) — YOUR BEST METHOD

**Pipeline that worked:**

```
lectures/  →  notes/ (instructor PDFs, 12 lectures)
                ↓
           Exercises/ (9 sets with solutions, worked through post-lecture)
                ↓
           master-reference/ (91-page LaTeX PDF — unified lookup)
                ↓
           Exam-reference/ (9 topic PDFs: Basic + Standard tiers)
                ↓
           prev-exam/ (7 historical exams + 1 LaTeX practice exam with embedded solutions)
                ↓
           EXAM → 10
```

**What made DBS work:**
- Topic-based reference tiers (Basic vs. Standard) — prevented cognitive overload
- LaTeX practice exam with solutions built into the same document
- Exercises done post-lecture with immediate solution checking
- Master reference was a single 91-page consolidated document — one place for everything
- Automated LaTeX build pipeline (`run.sh`) for practice exams
- Supplementary reference PDFs (`_KEY_ER_MAPPING`, `dictionary-ra-sql-operators`) for quick lookup

**Key characteristics:** Systematic, well-organized, exercises as primary learning tool, master reference as exam weapon.

---

### MI (Machine Intelligence) — Grade: 7 (C) — WHAT WENT WRONG

**Pipeline that partially worked:**

```
lectures/  →  notes/ (per-lecture PDFs)
                ↓
           master-reference/ (2 LaTeX docs: L1-L6 search + L7-L12 ML)
                ↓
           Exercises/ (problem sets, completed but not deeply internalized)
                ↓
           NOTEBOOKS-code-practice/ (Python: gradient descent, MLP, CNN — PART2 only)
                ↓
           exam-rehearsal/ (1 notebook: bike-sharing prediction)
                ↓
           EXAM → 7
```

**Your MI master references were strong:**
- Color-coded boxes: `definitionbox` (blue), `examplebox` (green), `notebox` (brown), `warningbox` (red)
- Pseudocode with algorithmic notation for every search algorithm
- Quick reference tables comparing algorithms (completeness, optimality, complexity)
- "Plain English" explanations paired with formal definitions
- Heavy formula emphasis for ML section (gradient descent, MSE, sigmoid, BCE)

**But here is what went wrong (why 7 instead of 10):**

| Problem | Description | Impact |
|---|---|---|
| **No implementation for PART1** | You never coded BFS, DFS, A* — only read pseudocode | Couldn't debug your own understanding |
| **Theory-practice gap** | Master ref is formula-heavy, notebooks are implementation-focused — no bridge between them | Weak on "derive" and "explain why" questions |
| **Passive consolidation** | Master references are well-organized but don't force active problem-solving | Organized but shallow understanding |
| **Exercises completed but not internalized** | You worked through solutions but didn't rewrite them, generate test cases, or compare approaches | Homework done ≠ mastery |
| **Late exam rehearsal** | Only 1 rehearsal notebook, near the end — too late to find gaps | Misunderstandings uncorrected |
| **No error catalog** | No "pitfalls" or "common mistakes" section in master reference | Same mistakes repeated |
| **No feedback loop** | Pipeline has no self-testing step — you don't know where you're weak until the exam | Blind spots persist |

---

### The Pattern: DBS = 10, MI = 7 — Why?

| Factor | DBS (10) | MI (7) |
|---|---|---|
| Nature | Applied, tool-based, visual | Abstract, mathematical, proof-heavy |
| Your approach | Exercises → master ref → drill prev-exams | Read → compile master ref → exercises → hope |
| Practice exams | 7 historical + 1 custom LaTeX | 1 rehearsal notebook |
| Active recall | Practice exam forces retrieval | Master ref encourages re-reading |
| Self-testing | LaTeX practice exam with embedded answers | None |
| Implementation | SQL queries are inherently hands-on | PART1 search algorithms never implemented |

**Bottom line:** You learn best through **exercises and practice exams** (DBS method), not through **reading and compiling references** (MI method). When the course is mathematical/abstract, you default to passive compilation — which doesn't work.

---

## Part 2: How Semester 6 Courses Map to Your Experience

### AC (Algorithms and Computability) — LIKE MI, NOT DBS

**AC is mathematical like MI was:**
- Algorithm design techniques (greedy, DP, backtracking, branch-and-bound)
- Complexity theory (Turing machines, NP-completeness, reductions)
- Proofs, derivations, formal analysis
- No tool to lean on, no simulation to run

**The danger:** You will instinctively use the MI method (compile a master reference, read exercises). That method gave you a 7. With AC's weaker foundation (you got 4 in both prerequisites), the MI method could give you a 4 or worse.

**Exam constraint:** Handwritten one-side A4 only. No master reference allowed.

**Prerequisite gaps (both scored 4):**
- Algorithms and Data Structures: Big-O, recurrences, basic DP, greedy, graphs
- Theoretical Foundations of CS: automata, formal languages, Turing machines, logic

---

### mtcps (Models and Tools for CPS) — LIKE DBS, BUT WITH FIGURES

**mtcps is visual and tool-based like DBS was:**
- 40-50% of lecture slides are diagrams, state machines, automata figures
- Heavy UPPAAL dependency (verification tool — like SQL was for DBS)
- Exercise-driven: model building, verification queries, scheduling problems
- 4 previous exams available (like DBS had 7)

**The opportunity:** You can use the DBS method here. Exercises → practice with UPPAAL → drill prev-exams.

**The challenge you identified:** Figures are hard to reproduce in LaTeX. DBS had tables and SQL (text-based). mtcps has timed automata, state machines, block diagrams, zone diagrams.

**mtcps exam format (from audit of 2023, 2023-reexam, 2024, 2025):**
- 6 exercises, 75 points, 4 hours, open book, digital submission
- ~25% calculation, ~40% drawing/modeling, ~35% explanation
- UPPAAL models provided with exam (you modify and verify)
- Python required for one exercise (dynamical systems/ODE)
- Always tested: synchronous components, asynchronous composition, timed automata, UPPAAL queries, control systems

**Topics by exam weight:**

| Topic | Exam Weight | Your Foundation |
|---|---|---|
| UPPAAL query writing and verification | **35%** | New — must learn |
| Synchronous/asynchronous components | 20% | Syntax & Semantics (7) helps |
| Timed automata and zones | 15% | Formal methods background helps |
| Control systems / dynamical systems (Python) | 20% | New — must learn |
| Scheduling (cyclic exec, FPS, EDF) | 10% | CompArch/OS (4) — weak |

---

## Part 3: Adapted Learning Strategy

### For AC — Use the "Anti-MI" Method

You cannot repeat the MI approach. Instead:

**Step 1: Patch foundations FIRST (Week 1)**
- Revisit Big-O, recurrences, Master theorem, basic DP, basic greedy, graph algorithms
- Revisit automata, DFA/NFA, formal languages, basic Turing machine notation
- Do this actively: solve problems, don't just re-read

**Step 2: Exercise-first learning (Weeks 2-4)**
- For each lecture: attempt the exercise BEFORE reading the solution
- Write down where you got stuck and why
- Build an **error catalog** (what MI was missing): "I forgot X", "I confused X with Y"
- This forces active recall instead of passive compilation

**Step 3: Build your A4 page iteratively (Weeks 2-6)**
- After each exercise set, write down what you needed but didn't have in your head
- That becomes your A4 page content
- Draft 1 (week 3) → Draft 2 (week 4) → Draft 3 (week 6) → Final (week 8)
- Practice handwriting it — your hand is the printer now, not LaTeX

**Step 4: Create your own practice problems (Weeks 4-6)**
- AC has NO previous exams. This is the biggest gap
- After each lecture, write 2-3 exam-style questions yourself
- Swap with classmates if possible
- Solve under timed conditions with only your A4 draft

**What NOT to do for AC:**
- Do NOT compile a 50-page master reference you can't bring to the exam
- Do NOT just read exercise solutions without attempting them first
- Do NOT spend time on beautiful LaTeX notes — handwriting is what you need to practice

**Where LaTeX notes ARE useful for AC:**
- Per-lecture summary notes for your own understanding (like MI's `notes/`)
- But keep them SHORT (1-2 pages per lecture max)
- Focus on: "What technique? When to use it? What's the recurrence/proof structure?"
- These notes are study material, NOT exam material (you can't bring them)

---

### For mtcps — Use the DBS Method (Adapted for Visual Content)

mtcps maps directly to how DBS worked. Use that pipeline:

**Step 1: Lectures + Exercises together (Weeks 3-5)**
- Work through exercises WITH UPPAAL open — hands-on, like SQL for DBS
- For each exercise: model it, verify it, modify it
- The tool is your learning medium, not the slides

**Step 2: Notes — adapt for visual content**
- You said: figures are hard to make in TeX for mtcps (unlike DBS which was text/tables)
- **Solution:** Use a hybrid approach:
  - LaTeX for definitions, formulas, query syntax, scheduling calculations
  - Hand-drawn or screenshot diagrams for timed automata, state machines, zones
  - Scan/photo and embed in your notes OR keep a separate "diagrams" folder
- The goal is not beautiful notes — it's notes you can quickly reference

**Step 3: Master reference — YES, build one (Weeks 5-6)**
- mtcps is open book. A master reference IS your exam weapon here (unlike AC)
- Structure it like your DBS master reference (91 pages, topic-based)
- Include: UPPAAL query syntax cheat sheet, zone computation steps, scheduling formulas, control system equations

**Step 4: Drill prev-exams (Weeks 5-7)**
- You have 4 previous exams. DBS had 7 and you got 10. Use the same approach
- Do them timed (4 hours each)
- After each: identify weak areas, update master reference
- The 2025 exam has solutions — save it for last as a mock exam

**Where LaTeX notes work for mtcps:**
- UPPAAL query syntax reference (text-based, perfect for LaTeX)
- Scheduling formulas and calculations (mathematical, good for LaTeX)
- Definitions of synchronous/asynchronous models (text-based)
- Control system equations (P, PD, PID controller formulas)

**Where LaTeX notes DON'T work for mtcps:**
- Timed automata diagrams (use screenshots from UPPAAL or hand-draw)
- Zone diagrams (graphical — hand-draw or screenshot)
- Block diagrams (graphical)
- State machine transitions (use UPPAAL screenshots)

---

## Part 4: Your Academic Profile

| Course | Grade | Semester | Relevance |
|---|---|---|---|
| Imperative Programming | **12** | S1 | — |
| Theoretical Foundations of CS | **4** | S1 | AC foundation (Turing machines, logic) |
| Algorithms and Data Structures | **4** | S2 | **Direct AC prerequisite** |
| Probability Theory and Linear Algebra | 10 | S2 | — |
| Object-Oriented Programming | 10 | S3 | — |
| Design and Evaluation of UI | **12** | S3 | — |
| Languages and Compilers | 10 | S4 | — |
| Syntax and Semantics | 7 | S4 | mtcps foundation (formal models) |
| Computer Architecture and OS | **4** | S4 | mtcps foundation (scheduling, real-time) |
| Machine Intelligence | 7 | S5 | Similar learning challenge to AC |
| Database Systems | 10 | S5 | Similar learning approach to mtcps |
| Agile Software Engineering | 7 | S5 | — |

**Pattern:** Strong in applied (10-12), weak in pure theory (4). You learn best through exercises and tools, worst through passive reading of abstract material.

---

## Part 5: 8-Week Schedule

### Week 1 (April 1-7): Patch AC foundations

- Revisit Algorithms & DS basics: Big-O, recurrences, DP, greedy, graphs
- Revisit Theoretical Foundations: automata, formal languages, Turing machines
- Do this ACTIVELY — solve old Sem1/Sem2 exercises, don't just re-read
- Start reading AC lectures 1-2

### Week 2 (April 8-14): AC exercises deep dive

- AC lectures 3-5 + attempt exercises 1-5 BEFORE reading solutions
- Start error catalog: what did you get wrong and why?
- Begin A4 page draft 1 — what do you keep needing to look up?
- Start short LaTeX notes per lecture (1-2 pages, technique + when to use)

### Week 3 (April 15-21): AC hard topics + mtcps start

- AC lectures 6-7 + exercises 6-7
- AC focus: NP-completeness, reductions, Turing machines — the exam core
- mtcps: Install UPPAAL, work through exercises 1-4 hands-on
- mtcps: Start LaTeX notes for definitions/formulas

### Week 4 (April 22-28): AC practice + mtcps catch-up

- AC: Redo weak exercises without solutions. Create 2-3 practice problems per lecture
- AC: A4 page draft 2
- mtcps: Exercises 5-7 in UPPAAL
- mtcps: Screenshot key diagrams for notes

### Week 5 (April 29 - May 5): mtcps intensive + AC maintenance

- mtcps: Finish exercises 8-9
- mtcps: Prev-exam 2023 (timed, 4 hours). Review mistakes
- mtcps: Start master-reference (LaTeX + screenshots)
- AC: Light review, refine error catalog, A4 draft 3

### Week 6 (May 6-12): mtcps exam drilling + AC finalization

- mtcps: Prev-exam 2024 (timed). Prev-exam 2023-reexam (timed)
- mtcps: Update master reference with weak areas
- AC: Create practice problems, solve under exam conditions with only A4
- AC: Practice handwriting A4 page cleanly

### Week 7 (May 13-23): Security sprint

- 10-15 days for Security course
- AC + mtcps: maintenance mode (30 min/day review)

### Week 8 (May 24 → Exam): Final review

- AC: Handwrite final A4 page (practice 2-3 times)
- AC: Solve problems timed with only A4
- mtcps: Prev-exam 2025 with solutions (final mock). Review master reference
- mtcps: Quick UPPAAL refresher on weak exercises

---

## Part 6: What to Create in the Repo

### AC

```
AC/
  lectures/        ✅ Have (7 lectures)
  Exercises/       ✅ Have (7 sets with solutions)
  notes/           ❌ CREATE — short LaTeX per lecture (technique + when to use, 1-2 pages)
  error-catalog/   ❌ CREATE — what you get wrong and why (this is what MI was missing)
  a4-drafts/       ❌ CREATE — photos/scans of handwritten A4 page iterations
```

### mtcps

```
mtcps/
  lectures/        ✅ Have (9 lectures)
  Exercises/       ✅ Have (9 sets)
  prev-exam/       ✅ Have (4 exams — massive advantage)
  notes/           ❌ CREATE — LaTeX for formulas/definitions + screenshots for diagrams
  master-reference/❌ CREATE — your open-book exam weapon (like DBS's 91-page PDF)
```

---

## Part 7: The Core Insight

**AC (mathematical, like MI):** Don't repeat the MI mistake. Exercise-first, error-catalog, active recall. The A4 constraint forces internalization. Your notes help you study but cannot save you in the exam.

**mtcps (visual/tool-based, like DBS):** Repeat the DBS success. UPPAAL is your SQL. Prev-exams are your practice exams. Build a master reference for open-book use. This is your stronger learning mode.

**Start AC today. It's the course where your method and your foundation are both weakest.**

# Seance: Project Brief (Kiroween 2026, Frankenstein category)

> **Tagline:** Summon your idea before you summon the code.
> **Working name:** Seance (rename freely).
> **Owner:** Vedant Hande
> **Deadline:** Friday, Dec 4, 2026, 2:00 PM Pacific = Sat, Dec 5, 3:30 AM IST. Aim to submit by the evening of Dec 3 IST.

---

## 0. How to use this file

1. Put this file in the repo root as `PROJECT_BRIEF.md`.
2. In Kiro IDE, start a **spec session** and tell Kiro: "Read PROJECT_BRIEF.md. Generate requirements.md only, using EARS format, for Feature 1. Do not write code yet."
3. **Edit what Kiro generates in your own words.** Judges score "spec-driven development" and you learn most here.
4. Only after you approve requirements, go to design, then tasks. Repeat per feature.
5. Section 9 lists the functions **you must hand-write**. Do not let Kiro write those first.

---

## 1. Problem statement

Beginner developers use AI coding tools in two bad ways:

- **They don't know how to talk to AI.** Experts use roles, constraints, examples, and clear requirements. Beginners type "build me a todo app" and accept whatever comes back. There is no standard practice, library, or tool that teaches this.
- **They stop thinking.** The AI writes everything, the developer cannot explain or change the code, and their skills shrink. (This is the builder's own situation, which is the strongest part of the story.)

**Who it is for:** beginner and junior developers, bootcamp students, and fresh graduates who use AI to code and want to stay in control and keep learning.

---

## 2. Solution in one paragraph

Seance is a web app with three stages. First, an **Interview**: an AI asks the developer structured questions about their idea (problem, users, features, tech stack, constraints, examples) and keeps going until a requirements checklist is complete, offering beginner help like "I don't know, suggest options" and examples. Second, a **Milestone tracker**: the finished interview becomes a plan of milestones, and after each one Seance writes a summary so the developer (and any AI) always knows where the project stands. Third, a **Learning Gate** (optional setting): after code is produced for a milestone, the developer must read a structure map of it and pass a short quiz before advancing. Missed concepts come back later via spaced repetition. Everything can be exported as Kiro-compatible spec and steering files.

---

## 3. Why Frankenstein (the "chimera")

The category asks for seemingly different technologies stitched into one useful thing. Seance combines:

| Piece | Role |
|---|---|
| LLM (Gemini API) with schema-constrained JSON output | Interviewer, plan generator, summarizer, quiz maker, answer grader |
| Deterministic requirements checklist and scoring | Decides "ready" instead of trusting the LLM's own confidence |
| AST code parser (acorn or @babel/parser) | Builds a real structure map of code so quizzes are grounded and not hallucinated |
| Spaced repetition (SM-2 algorithm) | Brings back concepts the developer missed |
| Kiro file export (specs, steering) and optional MCP server | Feeds the project state back into Kiro |

**Pitch line:** "An interviewer, a code reader, and a flashcard system, stitched together so AI helps you build without making you dumber."

---

## 4. Honest risks (read these)

- **Overlap with Kiro's spec mode.** Judges are Kiro people. Your differentiator is NOT the questions; it is the **Learning Gate** and the **beginner prompting guidance**. Lead the demo with the Learning Gate.
- **"90% sure" is not measurable by an LLM.** Do not ask the model how confident it is. Use the checklist score in section 6.
- **Time.** Roughly 8 days remain (from Nov 26). Section 12 lists what is must-have versus cut.
- **Hackathon does not equal fundamentals.** Keep 1 to 2 hours daily of no-AI practice (LeetCode easy, small programs from a blank file). That is what helps in interviews.
- **Privacy.** Users paste code and ideas. Use anonymous project IDs, no accounts, and say so in the README.

---

## 5. Tech stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (Node.js) everywhere | You know JS; one language to focus on |
| Backend | Express | Simple, you know it |
| Frontend | React + Vite + Tailwind + shadcn/ui | Ready-made components since UI is not your strength |
| Database | PostgreSQL (Supabase free tier) | You have used Supabase; use plain SQL via `pg` for hand-written parts to practice |
| LLM | Gemini API via official SDK; model name from env var `LLM_MODEL` | You have used it; free tier available |
| Validation | zod | Validate every LLM JSON response against a schema |
| Code parsing | acorn or @babel/parser (JS/TS); Python files fall back to LLM-only summary | Real structure map |
| Testing | vitest + fast-check (property-based testing) | Kiro PBT requirement and a real benefit for your algorithms |
| Deploy | Vercel (frontend), Render (backend) | Free, quick |

**No login for MVP.** Each project gets an unguessable UUID stored in localStorage. Add credentials info to the Devpost form only if needed.

---

## 6. Core logic specifications

### 6.1 Interview slots

| Slot key | Meaning | Required | Weight |
|---|---|---|---|
| `problem` | What problem is solved | yes | 3 |
| `users` | Who uses it | yes | 2 |
| `core_features` | 2 to 5 must-have features | yes | 3 |
| `tech_stack` | Language, framework, database | yes | 2 |
| `constraints` | Time, budget, skills, platform | yes | 1 |
| `non_goals` | What is explicitly out of scope | no | 1 |
| `examples` | Similar apps or inspiration | no | 1 |
| `success_criteria` | How you know it works | yes | 2 |
| `data_model` | Main things stored | no | 1 |

Each slot has a status: `empty` (score 0), `partial` (0.5), `complete` (1). The LLM proposes a status for a slot after each answer, with evidence quoted from the user's message. Your code decides what to do with it.

### 6.2 Readiness rule (the "90%")

```
readiness = sum(weight_i * score_i) / sum(weight_i)
ready = readiness >= 0.90 AND every required slot has status "complete"
```

### 6.3 Next question selection

Pick the incomplete slot with the highest `weight`; break ties by required first. If the user says "I don't know", mark the slot `needs_help` and switch to **suggestion mode** (see 6.4) instead of re-asking.

### 6.4 Beginner help

- **"I don't know" button:** AI proposes 3 options with one-line pros and cons and a recommended default.
- **"Show me an example" button:** AI shows a sample answer for that slot.
- **Prompting tips panel:** a short built-in library (role, context, constraints, output format, examples) shown next to the chat. Static content, hand-written.

### 6.5 Milestones and state machine

States: `planned -> in_progress -> built -> understood`.

- `planned -> in_progress`: user starts it.
- `in_progress -> built`: user submits code or marks it complete.
- `built -> understood`: learning gate passed (or gate is off/soft).
- In strict gate mode, the next milestone cannot start until the previous is `understood`.

### 6.6 Milestone summary (generated at `built`)

Fields: what was built, files touched, key decisions and why, open questions, next milestone, and a **handoff block** (a paragraph the user can paste to any AI to resume work).

### 6.7 Learning Gate

1. User submits code for a milestone (paste or file upload, size-limited).
2. Parser produces a **structure map**: files, imports, exports, functions, classes.
3. User sees the structure map first (the "read before you answer" step).
4. Quiz of 5 questions, generated from the structure map and code:
   - 3 multiple choice
   - 1 "what happens if we change X?"
   - 1 "explain this function in your own words" (LLM grades against a rubric)
5. Pass mark is a setting (default 70%).
6. Gate modes (setting): `off`, `soft` (warns but allows), `strict` (blocks).
7. Missed concepts become review cards.

### 6.8 Spaced repetition (SM-2)

Each review card stores: `ease` (start 2.5), `interval` (days), `repetitions`, `dueAt`.
User rates recall quality `q` from 0 to 5.

```
if q < 3: repetitions = 0; interval = 1
else:
  repetitions += 1
  interval = 1 if repetitions == 1
           = 6 if repetitions == 2
           = round(interval * ease) otherwise
ease = max(1.3, ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
dueAt = today + interval days
```

### 6.9 Export

- `requirements.md`, `design.md`, `tasks.md` in Kiro spec format (placed under `.kiro/specs/<name>/` by the user).
- `PROJECT_CONTEXT.md`: all milestone summaries combined, for handoff to any AI.
- Suggested steering files (product, tech, structure) generated from interview answers.

---

## 7. Features and priority

### Must have (MVP)
1. Interview chat with slot checklist and readiness meter
2. "I don't know" and "show example" helpers
3. Plan generation (milestones) from interview
4. Milestone states and summaries with handoff block
5. Learning Gate: paste code, structure map, quiz, pass mark, 3 gate modes
6. Export of requirements, summaries, and context as markdown
7. Deployed app with README and demo data

### Should have
8. Spaced repetition review page (SM-2)
9. AST-based structure map for JS/TS (otherwise LLM-only for MVP)
10. Kiro steering file export

### Could have (cut first)
11. GitHub URL import for code
12. MCP server exposing `get_project_context`
13. Prompt-quality score for the developer's prompts
14. Halloween polish (animations, sound)

---

## 8. Requirements in EARS format (starter for Kiro, edit them)

**Interview**
- WHEN the user submits an answer, THE SYSTEM SHALL update the status of affected slots with quoted evidence.
- WHEN readiness is below 0.90 or any required slot is not complete, THE SYSTEM SHALL ask a question about the highest-priority incomplete slot.
- WHEN the user clicks "I don't know", THE SYSTEM SHALL present three options with pros, cons, and a recommended default.
- IF the LLM response fails schema validation, THEN THE SYSTEM SHALL retry once and then show a friendly error without losing the user's answer.

**Milestones**
- WHEN the interview is ready, THE SYSTEM SHALL generate 3 to 6 milestones.
- WHEN a milestone becomes `built`, THE SYSTEM SHALL generate a summary including a handoff block.
- WHILE gate mode is `strict`, THE SYSTEM SHALL prevent starting a milestone until the previous one is `understood`.

**Learning Gate**
- WHEN code is submitted, THE SYSTEM SHALL show the structure map before the quiz.
- WHEN the quiz is submitted, THE SYSTEM SHALL compute the score and compare it to the pass mark.
- WHEN a question is missed, THE SYSTEM SHALL create a review card for its concept.

**Spaced repetition**
- WHEN the user rates a card, THE SYSTEM SHALL update ease, interval, repetitions, and dueAt using SM-2.

**General**
- THE SYSTEM SHALL store all data under an anonymous project UUID with no personal accounts.

---

## 9. Hand-write list (you write these, Kiro reviews)

These are pure functions. Write the test cases first, then the code, then ask Kiro to review.

| # | Function | Where it gets practiced |
|---|---|---|
| 1 | `computeReadiness(slots)` | loops, reduce, thresholds |
| 2 | `pickNextSlot(slots)` | sorting, tie-breaking |
| 3 | `canTransition(from, to, gateMode)` | state machine logic |
| 4 | `nextReview(card, quality)` | the SM-2 math |
| 5 | `gateDecision(score, passMark, mode)` | conditionals |
| 6 | `assemblePrompt(template, slots)` | string building |

Everything else (boilerplate, routes, UI, config, parsing glue) can be generated by Kiro. Rules:

1. Before accepting any generated file, explain it back in your own words. If you cannot, ask Kiro to walk through it and then rewrite one part yourself.
2. Make one small manual change to every generated file (rename, add a condition, fix a bug).
3. Debug for 15 minutes yourself before asking AI.
4. Commit messages are written by you.

---

## 10. Data model (starting point)

```
projects(id uuid pk, name, gate_mode, pass_mark, created_at)
slots(id, project_id fk, key, value text, status, evidence text, updated_at)
messages(id, project_id fk, role, content, created_at)
milestones(id, project_id fk, position, title, description, state)
summaries(id, milestone_id fk, content jsonb, created_at)
code_submissions(id, milestone_id fk, content text, structure_map jsonb, created_at)
quizzes(id, submission_id fk, questions jsonb, created_at)
attempts(id, quiz_id fk, answers jsonb, score numeric, passed boolean, created_at)
review_cards(id, project_id fk, concept text, ease, interval, repetitions, due_at)
```

## 11. API endpoints (starting point)

```
POST   /api/projects                         create project
GET    /api/projects/:id                     project + slots + readiness
POST   /api/projects/:id/interview/answer    submit answer, get next question
POST   /api/projects/:id/interview/help      mode: options | example
POST   /api/projects/:id/plan                generate milestones when ready
POST   /api/milestones/:id/transition        move state
POST   /api/milestones/:id/code              submit code, returns structure map
POST   /api/milestones/:id/quiz              generate quiz
POST   /api/quizzes/:id/attempt              submit answers, get score
GET    /api/projects/:id/reviews/due         due cards
POST   /api/reviews/:cardId/rate             rate card
GET    /api/projects/:id/export/:kind        requirements | design | tasks | context
```

---

## 12. Schedule (today is Thu Nov 26; times are IST)

| Date | Goal |
|---|---|
| **Thu Nov 26 (today)** | Install Kiro, **request the free credits now (request deadline is Dec 1, 12:00 PM PT = Dec 2, 1:30 AM IST)**. Create public GitHub repo, add license, create `.kiro/`. Write steering docs. Write requirements for Interview. |
| Fri Nov 27 | DB schema, backend skeleton. Hand-write items 1 and 2 plus tests. |
| Sat Nov 28 | LLM integration with schema validation. Interview UI and readiness meter. |
| Sun Nov 29 | Plan generation, milestone state machine (hand-write item 3), summaries. |
| Mon Nov 30 | Learning Gate: code submit, structure map, quiz, grading. Hand-write item 5. |
| Tue Dec 1 | SM-2 (hand-write item 4) and review page. Property-based tests. Deploy. |
| Wed Dec 2 | Bug fixes, exports, README, write-up draft. Cut anything unfinished. |
| Thu Dec 3 | Record demo video, upload to YouTube (public), social post, blog post. Fill Devpost form. |
| **Fri Dec 4** | Buffer. Final test of the live URL. **Submit by the evening IST.** Hard deadline is Dec 5, 3:30 AM IST. |

Every day also: 1 to 2 hours of fundamentals without AI.

**If you fall behind:** cut in this order: 14, 13, 12, 11, 9, 8. Never cut the Learning Gate; it is your differentiator.

---

## 13. How to use each Kiro feature (judges score this)

### Specs
One spec per feature (Interview, Milestones, Learning Gate, Review). You write or edit requirements; Kiro drafts design and tasks. Note in your write-up how this compared to vibe coding (for example, fewer rewrites, clearer scope).

### Steering docs (`.kiro/steering/`)
- `product.md`: problem, users, differentiator, what is out of scope.
- `tech.md`: stack from section 5, "validate all LLM output with zod", "no secrets in code".
- `structure.md`: folder layout and naming rules.
- `learning-rules.md` (your best one): "Do not write the functions listed in section 9 unless asked. When generating code, add a short explanation of each file. Prefer simple code a beginner can read. Ask before adding dependencies."

### Hooks (`.kiro/hooks/`)
Ideas, pick 2 or 3 and document what each saved you:
- On save of a `.ts` file: run lint and related tests.
- On changes to the hand-write list files: remind "write the test first".
- After a task is completed: update the milestone summary section in `docs/PROGRESS.md`.
- On new API route: check it has input validation.

### MCP
- GitHub MCP for issues, commits, and PR checks.
- Optional: Seance's own MCP server exposing `get_project_context`, so Kiro can read milestone summaries itself. This is a great story ("the app feeds Kiro") but is a stretch goal.

### Property-based testing (fast-check)
Good properties to test:
- `computeReadiness` always returns a value between 0 and 1.
- Marking a slot "more complete" never lowers readiness (monotonic).
- `ready` is never true if a required slot is not complete.
- SM-2: `ease` is never below 1.3; a quality below 3 always resets repetitions; interval never decreases on repeated successful reviews.
- State machine: no sequence of transitions skips `built` to reach `understood`.

### Kiro Powers / IDE vs CLI vs Web
Try at least one extra (for example a Power relevant to Postgres or testing) and note whether it helped. If you only use the IDE, say so honestly and explain why.

---

## 14. Folder structure (suggested)

```
seance/
  .kiro/
    specs/ steering/ hooks/ settings/
  apps/
    api/        Express + TypeScript
      src/core/     <- hand-written pure functions + tests
      src/routes/
      src/llm/      prompts + zod schemas
      src/parser/   AST structure map
    web/        React + Vite
  docs/
    PROGRESS.md
  LICENSE
  README.md
  PROJECT_BRIEF.md
```

**Important:** do not put `.kiro` in `.gitignore`. The repo must be public, have a visible open-source license (MIT is fine), and include everything needed to run it.

---

## 15. UI notes (you are not a UI person, so keep it simple)

- Use shadcn/ui components. Do not design from scratch.
- Dark theme, one accent color (purple or orange), a small ghost icon.
- Light Halloween flavor in wording only: "Summon" for start interview, "The Spirits ask..." for questions, "Banish doubts" for the quiz. Ask Kiro for a simple theme; do not spend more than a few hours on visuals.
- Three screens: **Interview** (chat + checklist + readiness meter), **Project board** (milestones with states and summaries), **Learning Gate** (structure map + quiz).

---

## 16. Demo video script (under 3 minutes)

| Time | Content |
|---|---|
| 0:00-0:20 | Problem: "I let AI write everything and stopped understanding my own code." Who it's for. |
| 0:20-1:00 | Interview: type a vague idea, show questions, "I don't know" help, readiness meter reaching ready. |
| 1:00-1:20 | Plan and milestone summary with handoff block. |
| 1:20-2:15 | Learning Gate: paste code, structure map, quiz, a failed question, pass. |
| 2:15-2:40 | Review card (SM-2) and export to Kiro spec files. |
| 2:40-3:00 | How Kiro was used (specs, steering, hooks, PBT) in one sentence each. End on the tagline. |

Show it working on the device it was built for. No copyrighted music.

---

## 17. Submission checklist

- [ ] Category: Frankenstein
- [ ] Public GitHub repo (not GitLab/Bitbucket) with detectable open-source license
- [ ] `/.kiro` directory committed (specs, hooks, steering) and not in `.gitignore`
- [ ] Working live URL (and test credentials in the form if any)
- [ ] Text description of features
- [ ] Demo video under 3 minutes, public on YouTube
- [ ] Kiro write-up (section 18)
- [ ] Bonus: **Social Blitz** post starting with `#KiroweenHackathon26` (must be posted during the submission period)
- [ ] Bonus: **Blog post** on a third-party platform, mentioning Kiroween 2026
- [ ] Bonus: **Best Demo** has no extra steps
- [ ] Check the Official Rules for student, startup, and "Ghost of Kiroween Past" eligibility. The Student prize requires all members to be currently enrolled, so it may not apply to you since you have graduated.

---

## 18. Kiro write-up template

Answer each honestly, with specifics.

1. **IDE/CLI/Web/Crew:** what you used and why.
2. **Custom agents:** if none, say so.
3. **Hooks:** which workflows, what time they saved.
4. **Spec-driven development:** how you structured specs, and one concrete example where the spec prevented a mistake. Compare to vibe coding.
5. **Steering:** which doc made the biggest difference (likely `learning-rules.md`).
6. **MCP:** what it enabled.
7. **PBT:** one bug the properties caught that unit tests would not have.
8. **Powers:** which ones, if any.
9. **What you hand-wrote vs. generated:** being honest here supports your product's message.

---

## 19. Judging criteria mapping

| Criterion | How Seance answers it |
|---|---|
| Potential Impact | Real problem for beginners; you are the first user |
| Technological Implementation | Variety of Kiro features, PBT on real algorithms, schema-validated LLM output |
| Design | Three clean screens, consistent theme, no dead ends |
| Innovation | Learning Gate, deterministic readiness, AST-grounded quizzes |
| Presentation | End-to-end demo under 3 minutes with a clear before/after story |

---

## 20. Definition of done for MVP

- A new user can go from a vague idea to a ready interview, a plan, and a summary without errors.
- The Learning Gate works in all three modes.
- All six hand-written functions have tests, including property-based ones for 1, 4, and 5.
- The live URL works from a fresh browser.
- README explains how to run it locally in under 5 commands.

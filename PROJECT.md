# PROJECT.md: Seance

> Agents: read this file first instead of scanning the repo. Humans: this is the one-page state of the project.
> Sections between the `seance:auto` markers are rewritten by `seance sync` (from Task 6). Edit everything else freely.

## What it is
Seance gives a project rules for AI agents and this self-updating PROJECT.md, then quizzes the developer on what the AI just built and brings missed concepts back with SM-2 spaced repetition. Kiroween 2026, Frankenstein category. Full plan: `PROJECT_BRIEF.md`.

## Features
| Feature | Command / surface | Status |
|---|---|---|
| Agent rules + PROJECT.md + hooks + tutor agent | `seance init` | planned |
| Auto-update PROJECT.md from git diff | `seance sync` (PostTaskExec hook) | planned |
| Quiz on the latest change | `seance quiz` | planned |
| SM-2 review of missed concepts | `seance review` | planned |
| MCP server for Kiro | `seance mcp` | planned |
| Web app + hosted API | Netlify | planned |

## Tasks
| # | Task | Model | Status |
|---|---|---|---|
| 1 | Repo foundation and Kiro setup | Sonnet 5.5 | done (Nov 26) |
| 2 | Review engine (SM-2, gate, scoring) | Opus spec / Sonnet code | done (Nov 26) |
| 3 | Structure map + structural questions | Sonnet 5.5 | done (Nov 26) |
| 4 | AI provider chain | Opus 5.5 | next |
| 5 | `seance init` | Sonnet 5.5 | planned |
| 6 | `seance sync` | Opus 5.5 | planned |
| 7 | `seance quiz` / `seance review` | Sonnet 5.5 | planned |
| 8 | Hosted backend (Netlify Functions) | Sonnet 5.5 | planned |
| 9 | Web app | Sonnet 5.5 | planned |
| 10 | Deploy (Netlify power) + npm publish | Sonnet 5.5 | planned |
| 11 | MCP server + Seance power | Opus 5.5 | planned |
| 12 | Dogfood, docs, submission | Sonnet / Haiku | planned |

## Tech stack
TypeScript (ESM), Node >=22.12, npm workspaces, vitest + fast-check, zod, @babel/parser, commander + @inquirer/prompts, `openai` SDK (Gemini/OpenRouter/NVIDIA), @modelcontextprotocol/sdk, Vite + React + Tailwind + shadcn/ui, Netlify Functions. No database.

## Folder structure
```
.kiro/          steering/ agents/ hooks/ specs/ (settings/ from Task 11)
packages/core/  pure logic + tests
packages/cli/   CLI commands (Task 5+)
packages/power/ Kiro power (Task 11)
apps/web/       web app + netlify/functions (Task 8+)
scripts/        hook helpers (log-usage.mjs)
docs/           KIRO_USAGE.md, usage-log.md
```

## Key decisions
- No database: state lives in `.seance/state.json` (CLI) and localStorage (web).
- "Ask until 90% sure" is a measurable completeness checklist in `init`, not an LLM's self-reported confidence.
- AI output is never trusted: zod validation, then fallback to deterministic questions from the AST.
- Dependencies are pinned and at least 7 days old; transitive exceptions are pinned with `overrides` in the root `package.json`.
- Task 8 reminder: the hosted API must validate an incoming `StructureMap` with a zod schema with caps (for example 50 files, 500 entries per list, 200 chars per name, `schemaVersion: 1`) before calling `generateStructuralQuestions`, which trusts its input.
- npm 12.2.3 crashes on install in this repo; use `npx -y npm@11.21.3 install` until that's fixed.

<!-- seance:auto:start -->
_Auto section: filled by `seance sync` once Task 6 is done._
<!-- seance:auto:end -->

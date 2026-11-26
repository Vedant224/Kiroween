---
inclusion: manual
---
# Model and credit budget

Credits at start: 3,995 (Nov 26 2026). Use `#model-budget` in chat to load this file.

## Which model for which work

| Work | Model | Cost |
|---|---|---|
| Specs (requirements, design), stuck bugs after 2 failed attempts, Tasks 4 (AI chain), 6 (sync), 11 (MCP) | Claude Opus 5.5 | 2.0x |
| All other implementation tasks, code reviews | Claude Sonnet 5.5 | 1.3x |
| Text only: usage-log summaries, KIRO_USAGE drafts, commit/PR text | Claude Haiku 5.5 | 0.06x |

Do not use: Qwen3 Coder Next, GPT-5.6 Sol, Grok, Kimi, Opus 4.x.

Custom agents pin these: `architect` = Opus 5.5, `builder` = Sonnet 5.5, `reviewer` = Sonnet 5.5.

## Daily checkpoints (remaining credits at end of day)

| End of day | At least |
|---|---|
| Nov 27 | 3,300 |
| Nov 29 | 2,400 |
| Dec 1 | 1,400 |
| Dec 3 | 600 (reserve) |

If below a checkpoint, step routine tasks down one level: Opus 5.5 -> Sonnet 5.5 -> Auto (1.0x) -> Haiku 5.5.
Step back up when above the line again. Record the balance each evening in `docs/KIRO_USAGE.md`.

## Habits that save credits
- Start a new chat per task.
- Keep always-on steering under about 60 lines total.
- Read `PROJECT.md` instead of scanning the whole repo.
- Run tests with `npm run test:core` instead of asking the agent to reason about correctness.

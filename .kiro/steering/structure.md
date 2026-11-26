---
inclusion: always
---
# Structure
- `packages/core/src/` pure logic, no I/O. One module per concern; tests beside code as `*.test.ts`.
- `packages/cli/src/commands/<command>.ts` one file per CLI command.
- `packages/power/` Kiro power (`plugin.json`, `skills/`, `mcp.json`). `apps/web/` Vite app, `apps/web/netlify/functions/` API.
- `scripts/` small Node helpers (`.mjs`) used by hooks. `docs/` KIRO_USAGE.md and usage-log.md.
- Names: kebab-case files, camelCase functions, PascalCase types/components. Named exports only.
- After each task: update `PROJECT.md` (task status) and `docs/KIRO_USAGE.md` (what Kiro feature helped).
- After each task or working milestone, once tests pass: stage files by name, commit as `Task N: <what changed>`, then `git push origin main`. Never commit failing tests, `.env`, or secrets; never force-push.
- Fix every review finding (blockers, should-fix and nits) in the same task before starting the next one. Update the spec first when the finding is a spec gap.

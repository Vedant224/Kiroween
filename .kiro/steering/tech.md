---
inclusion: always
---
# Tech
- TypeScript everywhere, ESM, Node >=22.12 (vitest 5 needs it). npm workspaces.
- CLI: commander + @inquirer/prompts. Parsing: @babel/parser. Validation: zod. MCP: @modelcontextprotocol/sdk (stdio).
- AI: `openai` SDK, base URLs/models from env. Chain Gemini -> OpenRouter -> NVIDIA -> structural fallback; 8 s per provider, 20 s total.
- Web: Vite + React + Tailwind + shadcn/ui. API: Netlify Functions. Storage: `.seance/state.json` / localStorage. No DB.
- Tests: vitest + fast-check. Pure logic lives in `packages/core` and gets property tests.
- Hook triggers (verified kiro.dev, Nov 2026): SessionStart, Stop, UserPromptSubmit, PreTaskExec, PostTaskExec, PreToolUse, PostToolUse, PostFileCreate, PostFileSave, PostFileDelete. Exit 2 blocks PreToolUse/UserPromptSubmit/PreTaskExec.
- Custom agents inherit default steering; add extra files via `resources`.

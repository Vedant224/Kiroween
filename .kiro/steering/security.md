---
inclusion: always
---
# Security and working rules
- Ask before doing work the user did not request, and before hard-to-reverse commands.
- Ask clarifying questions until the task's required info is complete; state assumptions.
- Ask before adding any dependency. Pin exact versions (`.npmrc` save-exact), commit the lockfile, run `npm audit`.
- Avoid versions published in the last 7 days; prefer a widely used package over a new one.
- Validate every AI response and every API request body with zod. Cap input size.
- No secrets in code, logs, or commits. Keys live in `.env` (local) or Netlify env vars.
- Never add `.kiro/` to `.gitignore`.

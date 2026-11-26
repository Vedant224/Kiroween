// Stop-hook helper: appends a timestamp and `git diff --stat` to docs/usage-log.md.
// Costs zero Kiro credits (plain shell command, no agent prompt). Never fails the hook.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const logPath = join(root, "docs", "usage-log.md");

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Kiro sends session context as JSON on stdin. Skip reading when run by hand from a terminal.
function readStdin() {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

let sessionId = "";
try {
  const raw = readStdin();
  if (raw) sessionId = String(JSON.parse(raw).session_id ?? "");
} catch {
  // Ignore malformed or missing stdin.
}

const stat = git(["diff", "--stat", "HEAD"]) || git(["diff", "--stat"]) || "(no uncommitted changes)";
const untracked = git(["ls-files", "--others", "--exclude-standard"])
  .split("\n")
  .filter(Boolean);

const lines = [
  `## ${new Date().toISOString()}${sessionId ? ` (session ${sessionId.slice(0, 8)})` : ""}`,
  "",
  "```",
  stat,
  untracked.length ? `untracked: ${untracked.length} file(s)` : "untracked: 0",
  "```",
  "",
];

try {
  if (!existsSync(logPath)) {
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, "# Usage log\n\nAppended automatically by the `log-usage` Stop hook after every agent turn.\n\n");
  }
  appendFileSync(logPath, lines.join("\n"));
} catch {
  // A logging failure must never break the agent turn.
}
process.exit(0);

// PreToolUse(Bash): before a command that runs `git commit`, block on
// whitespace errors in the worktree, the index and untracked files. Untracked
// files are included because `git add -A && git commit` stages them after
// this hook has already run.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runHook } from "./hook-input.mjs";

// Global options that consume the next token when written without "=".
const OPTIONS_WITH_VALUE = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);

export function runsGitCommit(command) {
  if (typeof command !== "string") return false;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      if (path.basename(tokens[i]) !== "git") continue;
      let j = i + 1;
      while (j < tokens.length && tokens[j].startsWith("-"))
        j += OPTIONS_WITH_VALUE.has(tokens[j]) ? 2 : 1;
      if (tokens[j] === "commit") return true;
    }
  }
  return false;
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

export function whitespaceProblems(cwd) {
  const problems = [];
  // Run both checks independently so each reports its own errors.
  for (const [label, args] of [
    ["worktree", ["diff", "--check"]],
    ["staged", ["diff", "--cached", "--check"]],
  ]) {
    const result = git(args, cwd);
    if (result.error || result.status !== 0)
      problems.push(`[${label}]\n${result.stdout}${result.stderr}`.trim());
  }
  const untracked = git(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    cwd,
  );
  if (untracked.error || untracked.status !== 0)
    problems.push("[untracked] CLAUDE_HOOK_UNTRACKED_LIST_FAILED");
  else
    for (const file of untracked.stdout.split("\0").filter(Boolean)) {
      // --no-index exits 1 for any difference; only --check output is a problem.
      const result = git(
        ["diff", "--no-index", "--check", "--", "/dev/null", file],
        cwd,
      );
      if (result.error || result.status > 1 || result.stdout.trim())
        problems.push(`[untracked]\n${result.stdout}${result.stderr}`.trim());
    }
  return problems;
}

export async function checkCommit(input, cwd = process.env.CLAUDE_PROJECT_DIR) {
  if (!runsGitCommit(input.tool_input?.command)) return "";
  const problems = whitespaceProblems(cwd || process.cwd());
  return problems.length
    ? problems.join("\n") +
        "\ngit diff --check failed; fix whitespace errors before committing"
    : "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runHook(checkCommit);

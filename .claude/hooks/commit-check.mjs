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

// Not a shell parser: line continuations, subshells, command substitution and
// quoted `bash -c 'git commit'` forms are normalized so they are still found.
// A false positive (e.g. `echo "git commit"`) only runs the check.
export function runsGitCommit(command) {
  if (typeof command !== "string") return false;
  const joined = command.replace(/\\\r?\n/g, " ");
  for (const segment of joined.split(/&&|\|\||\$\(|[;|\n()`]/)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .map((token) => token.replace(/^["']+|["']+$/g, ""))
      .filter(Boolean);
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

export function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

// Returns "" only for a confirmed clean result. A git that cannot start or is
// terminated by a signal is reported with a fixed code, never as clean.
export function gitProblem(label, result, { untracked = false } = {}) {
  if (result.error) return `[${label}] CLAUDE_HOOK_GIT_UNAVAILABLE`;
  if (result.status == null) return `[${label}] CLAUDE_HOOK_GIT_TERMINATED`;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  // `diff --no-index` exits 1 for any difference, so 1 alone is not a problem
  // there; an error on stderr (unreadable or changing file) still is.
  const clean = untracked
    ? result.status <= 1 && !stdout.trim() && !stderr.trim()
    : result.status === 0;
  return clean ? "" : `[${label}]\n${stdout}${stderr}`.trim();
}

export function whitespaceProblems(cwd, run = git) {
  // Run every check independently so each reports its own errors.
  const problems = [
    gitProblem("worktree", run(["diff", "--check"], cwd)),
    gitProblem("staged", run(["diff", "--cached", "--check"], cwd)),
  ];
  const listed = run(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  const listProblem = gitProblem("untracked", listed);
  if (listProblem) problems.push(listProblem);
  else
    for (const file of listed.stdout.split("\0").filter(Boolean))
      problems.push(
        gitProblem(
          "untracked",
          run(["diff", "--no-index", "--check", "--", "/dev/null", file], cwd),
          { untracked: true },
        ),
      );
  return problems.filter(Boolean);
}

export async function checkCommit(
  input,
  cwd = process.env.CLAUDE_PROJECT_DIR,
  run = git,
) {
  if (!runsGitCommit(input.tool_input?.command)) return "";
  const problems = whitespaceProblems(cwd || process.cwd(), run);
  return problems.length
    ? problems.join("\n") +
        "\nWhitespace check failed or could not run; resolve the above before committing"
    : "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runHook(checkCommit);

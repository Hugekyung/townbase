// Project Claude hooks (.claude/hooks). No network, DB or Key; temp git repos only.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkCommit,
  runsGitCommit,
} from "../../.claude/hooks/commit-check.mjs";
import { checkJson } from "../../.claude/hooks/check-json.mjs";

const hooks = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.claude/hooks",
);
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};
async function repo() {
  const dir = await mkdtemp(path.join(tmpdir(), "townbase-hook-"));
  git(dir, "init", "-q");
  await writeFile(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "a.txt");
  git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "i");
  return dir;
}

test("commit detection covers global options and compound commands", () => {
  for (const command of [
    "git commit -m x",
    "cd /repo && git add -A && git commit -F - <<EOF",
    "git -c user.name=x commit -m y",
    "git -C sub commit -m y",
    "git --no-pager commit -m y",
    "git --git-dir .git --work-tree . commit -m y",
    "/usr/bin/git commit -m y",
  ])
    assert.equal(runsGitCommit(command), true, command);
  for (const command of [
    "git status",
    "git log --grep commit",
    "echo commit",
    "git commit-tree HEAD^{tree}",
    undefined,
  ])
    assert.equal(runsGitCommit(command), false, String(command));
});

test("untracked files staged by the same command are checked", async () => {
  const dir = await repo();
  try {
    await writeFile(path.join(dir, "new.txt"), "x  \n");
    const message = await checkCommit(
      { tool_input: { command: "git add -A && git commit -m y" } },
      dir,
    );
    assert.match(message, /\[untracked\][\s\S]*new\.txt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("worktree and staged problems are both reported", async () => {
  const dir = await repo();
  try {
    await writeFile(path.join(dir, "a.txt"), "a  \n");
    git(dir, "add", "a.txt");
    await writeFile(path.join(dir, "a.txt"), "a  \nb  \n");
    const message = await checkCommit(
      { tool_input: { command: "git commit -m y" } },
      dir,
    );
    assert.match(message, /\[worktree\]/);
    assert.match(message, /\[staged\]/);
    assert.equal(
      await checkCommit({ tool_input: { command: "git status" } }, dir),
      "",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clean repository passes", async () => {
  const dir = await repo();
  try {
    await writeFile(path.join(dir, "new.txt"), "clean\n");
    assert.equal(
      await checkCommit({ tool_input: { command: "git commit -m y" } }, dir),
      "",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid hook input fails closed instead of disabling the guard", () => {
  for (const script of ["commit-check.mjs", "check-json.mjs"]) {
    const r = spawnSync(process.execPath, [path.join(hooks, script)], {
      input: "not json",
      encoding: "utf8",
    });
    assert.equal(r.status, 2, script);
    assert.match(r.stderr, /CLAUDE_HOOK_INPUT_INVALID/);
  }
});

test("JSON check reports only broken .json files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "townbase-hook-"));
  try {
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, '{"a":');
    await writeFile(path.join(dir, "ok.json"), '{"a":1}');
    assert.match(
      await checkJson({ tool_input: { file_path: bad } }),
      /JSON parse failed/,
    );
    assert.equal(
      await checkJson({
        tool_response: { filePath: path.join(dir, "ok.json") },
      }),
      "",
    );
    assert.equal(
      await checkJson({ tool_input: { file_path: path.join(dir, "x.md") } }),
      "",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

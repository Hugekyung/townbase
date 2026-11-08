import { OperationalLogger } from "../src/operations/operational-logger";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  realpath,
  mkdir,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
describe("operational diagnostic privacy", () => {
  let root: string;
  const before = process.env.TOWNBASE_OPERATIONS_PATH;
  beforeEach(async () => {
    root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "townbase-logs-")),
    );
    process.env.TOWNBASE_OPERATIONS_PATH = root;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
    if (before == null) delete process.env.TOWNBASE_OPERATIONS_PATH;
    else process.env.TOWNBASE_OPERATIONS_PATH = before;
  });
  it("persists only exact allowed codes and never extracts attacker-controlled code-shaped text", async () => {
    const log = new OperationalLogger();
    log.error("TOWNBASE_RAG_FAILED");
    log.error("secret TOWNBASE_PRIVATE_CANARY");
    log.error(new Error("document body canary"));
    const dir = path.join(root, "diagnostics"),
      names = await readdir(dir),
      file = path.join(dir, names[0]!);
    const text = await readFile(file, "utf8");
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(text).not.toMatch(/secret|PRIVATE_CANARY|document body/);
    expect(
      text
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s).code),
    ).toEqual([
      "TOWNBASE_RAG_FAILED",
      "TOWNBASE_APPLICATION_ERROR",
      "TOWNBASE_APPLICATION_ERROR",
    ]);
  });
  it("refuses diagnostic directory symlinks without writing to their target", async () => {
    const target = path.join(root, "other");
    await mkdir(target);
    await symlink(target, path.join(root, "diagnostics"));
    const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    new OperationalLogger().error("TOWNBASE_RAG_FAILED");
    expect(await readdir(target)).toEqual([]);
    expect(stderr.mock.calls.flat().join(" ")).not.toContain(root);
  });
});

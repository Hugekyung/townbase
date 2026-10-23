import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeTokenFile } from "../src/setup/token-file";

describe("bootstrap file durability", () => {
  it("syncs content before rename and the directory before reporting success", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "townbase-token-sync-"),
    );
    const original = {
      TOWNBASE_BOOTSTRAP_PATH: process.env.TOWNBASE_BOOTSTRAP_PATH,
      TOWNBASE_DOCUMENTS_PATH: process.env.TOWNBASE_DOCUMENTS_PATH,
      TOWNBASE_ATTACHMENTS_PATH: process.env.TOWNBASE_ATTACHMENTS_PATH,
    };
    process.env.TOWNBASE_BOOTSTRAP_PATH = path.join(directory, "bootstrap");
    process.env.TOWNBASE_DOCUMENTS_PATH = path.join(directory, "documents");
    process.env.TOWNBASE_ATTACHMENTS_PATH = path.join(directory, "attachments");
    await fs.mkdir(process.env.TOWNBASE_DOCUMENTS_PATH);
    await fs.mkdir(process.env.TOWNBASE_ATTACHMENTS_PATH);
    const events: string[] = [];
    const open = fs.open;
    const rename = fs.rename;
    jest.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      const sync = handle.sync.bind(handle);
      jest.spyOn(handle, "sync").mockImplementation(async () => {
        events.push(flags === "r" ? "directory-sync" : "file-sync");
        await sync();
      });
      return handle;
    });
    jest.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      events.push("rename");
      await rename(from, to);
    });
    try {
      await writeTokenFile("synthetic-token");
      expect(events).toEqual(["file-sync", "rename", "directory-sync"]);
      expect(
        await fs.readFile(path.join(directory, "bootstrap/token"), "utf8"),
      ).toBe("synthetic-token\n");
    } finally {
      jest.restoreAllMocks();
      await fs.rm(directory, { recursive: true, force: true });
      for (const [key, value] of Object.entries(original)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

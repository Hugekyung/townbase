import io from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { FileStorage } from "../src/files/file-storage";

describe("D01 filesystem failure cleanup and safe codes", () => {
  let root: string, storage: FileStorage;
  const key = "11111111-1111-4111-8111-111111111111.bin";
  const failure = () =>
    Object.assign(new Error("private /synthetic/secret filesystem detail"), {
      code: "EIO",
    });
  beforeEach(async () => {
    root = await io.realpath(
      await io.mkdtemp(path.join(tmpdir(), "townbase-pr40-storage-")),
    );
    storage = new FileStorage(root);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await io.rm(root, { recursive: true, force: true });
  });
  async function safeError(operation: Promise<unknown>) {
    const error = await operation.then(
      () => {
        throw new Error("Expected rejection");
      },
      (e) => e,
    );
    expect(error.code).toBe("storage_unavailable");
    expect(error.message).toBe("storage_unavailable");
    expect(error).not.toHaveProperty("path");
  }
  test.each(["write", "sync", "close", "write_and_close"])(
    "%s failure attempts unlink even when close fails",
    async (stage) => {
      const open = io.open;
      jest
        .spyOn(io, "open")
        .mockImplementation(async (...args: Parameters<typeof io.open>) => {
          const handle = await open(...args);
          if (stage === "write" || stage === "write_and_close")
            jest.spyOn(handle, "writeFile").mockRejectedValue(failure());
          if (stage === "sync")
            jest.spyOn(handle, "sync").mockRejectedValue(failure());
          if (stage === "close" || stage === "write_and_close") {
            const close = handle.close.bind(handle);
            let closed = false;
            jest.spyOn(handle, "close").mockImplementation(async () => {
              if (!closed) {
                await close();
                closed = true;
              }
              throw failure();
            });
          }
          return handle;
        });
      await safeError(storage.write(Buffer.from("synthetic")));
      expect(await io.readdir(root)).toEqual([]);
    },
  );
  test("failed open does not unlink a path it never owned", async () => {
    jest.spyOn(io, "open").mockRejectedValue(failure());
    const unlink = jest.spyOn(io, "unlink");
    await safeError(storage.write(Buffer.from("synthetic")));
    expect(unlink).not.toHaveBeenCalled();
  });
  test("unlink failure is reported safely after write/close failure", async () => {
    const open = io.open;
    jest
      .spyOn(io, "open")
      .mockImplementation(async (...args: Parameters<typeof io.open>) => {
        const handle = await open(...args);
        jest.spyOn(handle, "sync").mockRejectedValue(failure());
        return handle;
      });
    const unlink = jest.spyOn(io, "unlink").mockRejectedValue(failure());
    await safeError(storage.write(Buffer.from("synthetic")));
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(await io.readdir(root)).toHaveLength(1); // Known deletion failure, never claim complete cleanup.
  });
  test.each(["write", "read", "remove"])(
    "%s directory error has no raw path",
    async (operation) => {
      jest.spyOn(io, "mkdir").mockRejectedValue(failure());
      await safeError(
        operation === "write"
          ? storage.write(Buffer.from("synthetic"))
          : operation === "read"
            ? storage.read(key)
            : storage.remove(key),
      );
    },
  );
  test("missing read/remove and symlink are classified consistently", async () => {
    await safeError(storage.read(key));
    await safeError(storage.remove(key));
    const target = path.join(root, "target");
    await io.writeFile(target, "synthetic", { mode: 0o600 });
    await io.symlink(target, path.join(root, key));
    await safeError(storage.read(key));
    expect(await io.readFile(target, "utf8")).toBe("synthetic");
  });
  test("read I/O and close errors are safe", async () => {
    const stored = await storage.write(Buffer.from("synthetic"));
    const open = io.open;
    jest
      .spyOn(io, "open")
      .mockImplementation(async (...args: Parameters<typeof io.open>) => {
        const handle = await open(...args);
        jest.spyOn(handle, "read").mockRejectedValue(failure());
        const close = handle.close.bind(handle);
        jest.spyOn(handle, "close").mockImplementation(async () => {
          await close();
          throw failure();
        });
        return handle;
      });
    await safeError(storage.read(stored));
  });
});

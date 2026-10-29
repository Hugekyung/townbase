import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  opendir,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FILE_LIMITS, FileError } from "./file-contract";

// Server-controlled root + generated keys only. No caller paths, suffixes or directories.
export class FileStorage {
  constructor(private readonly root: string) {}
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof FileError) throw error;
      // Do not expose raw filesystem paths, errno messages or cleanup errors.
      throw new FileError("storage_unavailable");
    }
  }
  private async directory(): Promise<string> {
    if (!path.isAbsolute(this.root)) throw new FileError("storage_unavailable");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await lstat(this.root);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0 ||
      (await realpath(this.root)) !== this.root
    )
      throw new FileError("storage_unavailable");
    return this.root;
  }
  async write(bytes: Buffer): Promise<string> {
    if (bytes.length === 0 || bytes.length > FILE_LIMITS.bytes)
      throw new FileError("file_too_large");
    return this.safe(async () => {
      const root = await this.directory(),
        key = `${randomUUID()}.bin`,
        target = path.join(root, key);
      // If open fails, we do not own this path and must not unlink an existing file.
      const handle = await open(
        target,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      let complete = false;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
        // A close failure must go through the same unlink path as write/sync failure.
        await handle.close();
        complete = true;
        return key;
      } finally {
        if (!complete) {
          // Cleanup steps are independent: a second close failure must not skip unlink.
          await handle.close().catch(() => undefined);
          await unlink(target); // Failure is also reported as storage_unavailable.
        }
      }
    });
  }
  async remove(key: string): Promise<void> {
    return this.safe(async () => {
      this.validKey(key);
      await unlink(path.join(await this.directory(), key));
    });
  }
  // Used only under D02's cross-process file lock. Missing means already cleaned.
  async removeIfPresent(key: string): Promise<void> {
    return this.safe(async () => {
      this.validKey(key);
      try {
        await unlink(path.join(await this.directory(), key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
  }
  async *keys(): AsyncGenerator<string> {
    try {
      const directory = await opendir(await this.directory());
      for await (const entry of directory) {
        if (!entry.isFile()) throw new FileError("storage_unavailable");
        this.validKey(entry.name);
        yield entry.name;
      }
    } catch {
      throw new FileError("storage_unavailable");
    }
  }
  async read(key: string): Promise<Buffer> {
    return this.safe(async () => {
      this.validKey(key);
      const handle = await open(
        path.join(await this.directory(), key),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.size < 1 ||
          info.size > FILE_LIMITS.bytes ||
          info.nlink !== 1 ||
          (info.mode & 0o077) !== 0
        )
          throw new FileError("storage_unavailable");
        // Size is checked on this exact open inode before reading. Cap allocation even if it grows.
        const output = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < output.length) {
          const result = await handle.read(
            output,
            length,
            output.length - length,
            null,
          );
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        if (length !== info.size) throw new FileError("storage_unavailable");
        return output.subarray(0, length);
      } finally {
        await handle.close();
      }
    });
  }
  private validKey(key: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/.test(
        key,
      )
    )
      throw new FileError("storage_unavailable");
  }
}

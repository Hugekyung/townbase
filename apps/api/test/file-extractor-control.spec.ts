import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import processes from "node:child_process";
import fs from "node:fs";
import { FileExtractor } from "../src/files/file-extractor";
import { FILE_LIMITS } from "../src/files/file-contract";

describe("D01 child termination boundary", () => {
  let child: EventEmitter & {
    stdin: PassThrough;
    stdio: unknown[];
    kill: jest.Mock;
    pid: number;
  };
  let channel: PassThrough;
  beforeEach(() => {
    jest.useFakeTimers();
    channel = new PassThrough();
    child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdio: [null, null, null, channel],
      kill: jest.fn(() => true),
      pid: 999999,
    });
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest
      .spyOn(processes, "spawn")
      .mockReturnValue(child as unknown as processes.ChildProcess);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  test("deadline kills child, waits for close, and releases busy slot only then", async () => {
    const extractor = new FileExtractor();
    const pending = extractor.extract("a.txt", Buffer.from("text"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "extraction_timeout",
    });
    jest.advanceTimersByTime(FILE_LIMITS.timeoutMs);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    await expect(
      extractor.extract("b.txt", Buffer.from("text")),
    ).rejects.toMatchObject({ code: "parser_busy" });
    child.emit("close", null, "SIGKILL");
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });
  test("abrupt OOM/crash is not successful empty extraction", async () => {
    const pending = new FileExtractor().extract("a.txt", Buffer.from("text"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "parser_failed",
    });
    child.emit("close", 133);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });
  test.each([
    "garbage",
    '{"ok":false,"code":"secret-error-body"}',
    '{"ok":true,"result":{"format":"txt","segments":[],"codePoints":0}}',
    '{"ok":true,"result":{"format":"txt","segments":[{"text":"x","location":{"lineStart":1,"lineEnd":1},"headingPath":[]}],"codePoints":2}}',
    '{"ok":true,"result":{"format":"txt","segments":[{"text":"x","location":{"lineStart":2,"lineEnd":1},"headingPath":[]}],"codePoints":1}}',
  ])("malformed child output is a safe error: %s", async (output) => {
    const pending = new FileExtractor().extract("a.txt", Buffer.from("text"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "parser_failed",
    });
    channel.write(output);
    child.emit("close", 0);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });
  test("response channel cap kills overflowing child", async () => {
    const pending = new FileExtractor().extract("a.txt", Buffer.from("text"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "extraction_limit",
    });
    channel.write(Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", null, "SIGKILL");
    await rejected;
  });
  test("spawn error clears handles and reports unavailable", async () => {
    const pending = new FileExtractor().extract("a.txt", Buffer.from("text"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "parser_unavailable",
    });
    child.emit("error", new Error("local private detail"));
    child.emit("close", -2);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });
  test("child gets no account secrets, NODE_OPTIONS, writable filesystem or subprocess permission", async () => {
    const pending = new FileExtractor().extract("a.txt", Buffer.from("text"));
    const spawn = jest.mocked(processes.spawn).mock.calls[0]!;
    const options = spawn[2] as processes.SpawnOptions;
    expect(options.env).toEqual({ LANG: "C.UTF-8", TZ: "UTC" });
    const args = spawn[1] as string[];
    expect(args).toContain("--permission");
    expect(args).not.toContain("--allow-child-process");
    expect(args.some((arg) => arg.startsWith("--allow-fs-write"))).toBe(false);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "parser_failed",
    });
    child.emit("close", 1);
    await rejected;
  });
});

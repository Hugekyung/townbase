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
    jest.spyOn(console, "error").mockImplementation(() => undefined);
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
  test("manual cancellation releases the active child and a later extraction succeeds", async () => {
    const extractor = new FileExtractor();
    const signal = new AbortController();
    const first = extractor.extract(
      "a.txt",
      Buffer.from("text"),
      signal.signal,
    );
    const rejected = expect(first).rejects.toMatchObject({
      code: "extraction_cancelled",
    });
    signal.abort();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", null, "SIGKILL");
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
    child.kill.mockClear();
    extractor.cancel();
    expect(child.kill).not.toHaveBeenCalled();
    const nextChannel = new PassThrough();
    const next = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdio: [null, null, null, nextChannel],
      kill: jest.fn(() => true),
      pid: 999999,
    });
    jest
      .mocked(processes.spawn)
      .mockReturnValueOnce(next as unknown as processes.ChildProcess);
    const second = extractor.extract(
      "b.txt",
      Buffer.from("x"),
      new AbortController().signal,
    );
    signal.signal.dispatchEvent(new Event("abort")); // A stale signal must not cancel this child.
    const result = {
      format: "txt",
      segments: [
        { text: "x", headingPath: [], location: { lineStart: 1, lineEnd: 1 } },
      ],
      codePoints: 1,
    };
    nextChannel.write(JSON.stringify({ ok: true, result }));
    next.emit("close", 0);
    await expect(second).resolves.toEqual(result);
    expect(next.kill).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  test("a cancellation during preparation prevents spawning and does not poison the next job", async () => {
    const extractor = new FileExtractor(),
      controller = new AbortController();
    controller.abort();
    await expect(
      extractor.extract("a.txt", Buffer.from("x"), controller.signal),
    ).rejects.toMatchObject({ code: "extraction_cancelled" });
    expect(processes.spawn).not.toHaveBeenCalled();
    const later = extractor.extract("b.txt", Buffer.from("x"));
    const rejected = expect(later).rejects.toMatchObject({
      code: "extraction_cancelled",
    });
    expect(processes.spawn).toHaveBeenCalledTimes(1);
    extractor.cancel();
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
  test("error before close keeps the slot and watchdog until actual close", async () => {
    const extractor = new FileExtractor();
    const pending = extractor.extract("a.txt", Buffer.from("text"));
    let settled = false;
    const outcome = pending.then(
      () => {
        settled = true;
        return "success";
      },
      (error) => {
        settled = true;
        return error.code;
      },
    );
    child.emit("error", new Error("synthetic live-child error"));
    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(
      extractor.extract("b.txt", Buffer.from("text")),
    ).rejects.toMatchObject({ code: "parser_busy" });
    jest.advanceTimersByTime(FILE_LIMITS.timeoutMs);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("error", new Error("synthetic kill race"));
    child.emit("close", 1);
    expect(await outcome).toBe("parser_unavailable");
    expect(jest.getTimerCount()).toBe(0);
    const retry = extractor.extract("b.txt", Buffer.from("text"));
    const rejected = expect(retry).rejects.toMatchObject({
      code: "parser_failed",
    });
    child.emit("close", 1);
    await rejected;
  });
  test.each(["false", "true_without_close", "throw", "error_event"])(
    "bounded termination handles %s without admitting a second live parser",
    async (failure) => {
      const extractor = new FileExtractor();
      if (failure === "false") child.kill.mockReturnValue(false);
      if (failure === "throw")
        child.kill.mockImplementation(() => {
          throw new Error("private kill failure");
        });
      if (failure === "error_event")
        child.kill.mockImplementation(() => {
          child.emit("error", new Error("private kill failure"));
          return false;
        });
      const pending = extractor.extract("a.txt", Buffer.from("text"));
      const rejected = expect(pending).rejects.toMatchObject({
        code: "parser_unavailable",
      });
      jest.advanceTimersByTime(FILE_LIMITS.timeoutMs + 1000);
      await rejected;
      expect(child.kill).toHaveBeenCalledTimes(3);
      expect(jest.getTimerCount()).toBe(0);
      expect(console.error).toHaveBeenCalledWith(
        "TOWNBASE_PARSER_TERMINATION_FAILED",
      );
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(child.stdin.destroyed).toBe(true);
      expect(channel.destroyed).toBe(true);
      await expect(
        extractor.extract("b.txt", Buffer.from("other")),
      ).rejects.toMatchObject({ code: "parser_unavailable" });
      expect(processes.spawn).toHaveBeenCalledTimes(1);
      channel.emit("data", Buffer.from('{"ok":true}')); // Late output cannot resurrect this request.
      child.emit("close", null, "SIGKILL");
      const next = extractor.extract("b.txt", Buffer.from("other"));
      const nextRejected = expect(next).rejects.toMatchObject({
        code: "parser_failed",
      });
      expect(processes.spawn).toHaveBeenCalledTimes(2);
      child.emit("close", 1);
      await nextRejected;
    },
  );
  test("an early child error also has a bounded recovery deadline", async () => {
    const pending = new FileExtractor().extract("a.txt", Buffer.from("text"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "parser_unavailable",
    });
    child.emit("error", new Error("synthetic early failure"));
    jest.advanceTimersByTime(1000);
    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
    child.emit("close", 1);
  });
  test("close during retry preserves timeout reason and cancels the recovery deadline", async () => {
    const pending = new FileExtractor().extract("a.txt", Buffer.from("text"));
    const rejected = expect(pending).rejects.toMatchObject({
      code: "extraction_timeout",
    });
    jest.advanceTimersByTime(FILE_LIMITS.timeoutMs + 250);
    child.emit("close", null, "SIGKILL");
    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
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

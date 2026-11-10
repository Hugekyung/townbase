import test from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  chmod,
  rm,
  realpath,
  access,
  mkdir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  docker,
  streamOut,
  streamIn,
  observeDockerChild,
  BackupChildUnconfirmed,
} from "../backup-process.mjs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

test("backup-import collision leaves the existing managed backup unchanged", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "townbase-import-")),
  );
  try {
    const dir = path.join(root, "backups");
    await mkdir(dir, { mode: 0o700 });
    const name = "townbase-2026-11-08T00-00-00-000Z-" + randomUUID() + ".tbk";
    await writeFile(path.join(dir, name), "EXISTING_SYNTHETIC_BACKUP", {
      mode: 0o600,
    });
    const result = spawnSync(
      process.execPath,
      ["deployment/restore-agent.mjs", "backup-import", name],
      {
        cwd: process.cwd(),
        env: { ...process.env, TOWNBASE_OPERATIONS_PATH: root },
        input: "NEW_SYNTHETIC_BACKUP",
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.equal(
      await readFile(path.join(dir, name), "utf8"),
      "EXISTING_SYNTHETIC_BACKUP",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function withFakeDocker(script, work) {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "townbase-docker-child-")),
  );
  const previous = process.env.PATH;
  try {
    await writeFile(
      path.join(root, "docker"),
      `#!${process.execPath}\n${script}`,
    );
    await chmod(path.join(root, "docker"), 0o700);
    const parsed = spawnSync(
      process.execPath,
      ["--check", path.join(root, "docker")],
      { encoding: "utf8" },
    );
    assert.equal(parsed.status, 0, parsed.stderr);
    process.env.PATH = root;
    await work(root);
  } finally {
    process.env.PATH = previous;
    await rm(root, { recursive: true, force: true });
  }
}
test("stream dump and restore execute the real helper and preserve exact bytes", async () => {
  await withFakeDocker(
    `const fs=require('node:fs');if(process.argv[2]==='dump'){process.stdout.write('SYNTHETIC_DUMP');}else{let data=[];process.stdin.on('data',b=>data.push(b));process.stdin.on('end',()=>fs.writeFileSync(process.argv[3],Buffer.concat(data)));}`,
    async (root) => {
      const dump = path.join(root, "dump"),
        restored = path.join(root, "restored");
      await streamOut(["dump"], dump);
      await streamIn(["restore", restored], dump);
      assert.equal(await readFile(restored, "utf8"), "SYNTHETIC_DUMP");
    },
  );
});
test("an actual stdin EPIPE rejects even when the child would otherwise exit successfully", async () => {
  await withFakeDocker(
    `require('node:fs').closeSync(0);setTimeout(()=>process.exit(0),1000);`,
    async () => {
      await assert.rejects(
        docker(["input"], Buffer.alloc(8 * 1024 * 1024)),
        (e) => e.code === "EPIPE",
      );
    },
  );
});
test("stalled Docker CLI is killed and observed before returning deadline failure", async () => {
  await withFakeDocker(
    `require('node:fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);`,
    async (root) => {
      const pidFile = path.join(root, "pid");
      await assert.rejects(
        // Leave room for Node fixture startup under parallel test load; still
        // require actual deadline rejection and observed child termination.
        docker([pidFile], undefined, { deadlineMs: 2000 }),
        /deadline exceeded/,
      );
      const pid = Number(await readFile(pidFile, "utf8"));
      assert.throws(
        () => process.kill(pid, 0),
        (e) => e.code === "ESRCH",
      );
    },
  );
});
test("stream dump and restore also obey their deadlines", async () => {
  await withFakeDocker(`setInterval(()=>{},1000);`, async (root) => {
    const input = path.join(root, "input");
    await writeFile(input, "SYNTHETIC");
    await assert.rejects(
      streamOut([], path.join(root, "dump"), { deadlineMs: 100 }),
      /deadline exceeded/,
    );
    await assert.rejects(
      streamIn([], input, { deadlineMs: 100 }),
      /deadline exceeded/,
    );
  });
});
test("unconfirmed child termination is bounded and cannot authorize plaintext cleanup", async () => {
  const child = new EventEmitter();
  Object.assign(child, {
    pid: 123,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    unref() {},
    kill() {
      return false;
    },
  });
  await assert.rejects(
    observeDockerChild(child, 1).done,
    (e) => e instanceof BackupChildUnconfirmed && e.cleanupSafe === false,
  );
});
for (const failurePoint of ["dump", "backup-import"])
  test(`real backup CLI removes plaintext stage after ${failurePoint} failure`, async () => {
    const fixture = `const fs=require('node:fs'),path=require('node:path');fs.appendFileSync(process.env.DUMP_PROBE+'.trace',JSON.stringify(process.argv.slice(2))+'\\n');const args=process.argv.slice(2),idApi='a'.repeat(24),idPg='b'.repeat(24);if(args.includes('backup-import')){fs.writeFileSync(process.env.IMPORT_PROBE,'entered');fs.closeSync(0);setTimeout(()=>process.exit(0),1000);}else if(args[0]==='compose'){const service=args.at(-1);console.log(service==='api'?idApi:idPg);}else if(args[0]==='inspect'){const api=args[1]===idApi;console.log(JSON.stringify([{Config:{Labels:{'com.docker.compose.project':'townbase-cli-failure-test','com.docker.compose.service':api?'api':'postgres'}},State:{Running:!api}}]));}else if(args[0]==='cp'){fs.mkdirSync(args.at(-1),{recursive:true});}else if(args.includes('pg_dump')){fs.writeFileSync(process.env.DUMP_PROBE,'entered');if(process.env.IMPORT_PROBE){process.stdout.write(Buffer.alloc(8*1024*1024,0x61));}else{process.stdout.write('PARTIAL_PLAINTEXT');process.exitCode=1;}}else{process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({installationId:'primary',workspaceId:'synthetic-workspace',initialized:true,migrations:[]})));}`;
    await withFakeDocker(fixture, async (root) => {
      const workspace = path.join(root, "workspace"),
        dot = path.join(workspace, ".townbase"),
        archive = path.join(root, "archives"),
        key = path.join(root, "key"),
        probe = path.join(root, "dump-entered");
      await mkdir(dot, { recursive: true, mode: 0o700 });
      await chmod(dot, 0o700);
      await writeFile(path.join(dot, "compose.env"), "SYNTHETIC_FIXTURE=1\n", {
        mode: 0o600,
      });
      await mkdir(archive, { mode: 0o700 });
      await writeFile(key, Buffer.alloc(32, 7).toString("base64url"), {
        mode: 0o600,
      });
      const result = spawnSync(
        process.execPath,
        [
          path.resolve("deployment/backup.mjs"),
          "create",
          "--project=townbase-cli-failure-test",
          "--key-file=" + key,
          "--directory=" + archive,
        ],
        {
          cwd: workspace,
          env: {
            ...process.env,
            DUMP_PROBE: probe,
            ...(failurePoint === "backup-import"
              ? { IMPORT_PROBE: probe + ".import" }
              : {}),
          },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(result.status, 1, result.stderr);
      assert.equal(
        await readFile(probe, "utf8").catch(
          async () =>
            "MISSING; " +
            (await readFile(probe + ".trace", "utf8").catch(
              () => "no trace; ",
            )) +
            result.stderr,
        ),
        "entered",
      );
      if (failurePoint === "backup-import")
        assert.equal(await readFile(probe + ".import", "utf8"), "entered");
      assert.equal(
        (await (await import("node:fs/promises")).readdir(dot)).some((n) =>
          n.startsWith("backup-staging-"),
        ),
        false,
      );
    });
  });

test("backup CLI gives document and journal copies the transfer deadline, while metadata keeps its shorter bound", async () => {
  const fixture = `const fs=require('node:fs');const args=process.argv.slice(2),api='a'.repeat(24),pg='b'.repeat(24);if(args.includes('run')){process.stdin.resume();}else if(args[0]==='compose'){console.log(args.at(-1)==='api'?api:pg);}else if(args[0]==='inspect'){const isApi=args[1]===api;console.log(JSON.stringify([{Config:{Labels:{'com.docker.compose.project':'townbase-copy-deadline-test','com.docker.compose.service':isApi?'api':'postgres'}},State:{Running:!isApi}}]));}else if(args[0]==='cp'){fs.mkdirSync(args.at(-1),{recursive:true});fs.appendFileSync(process.env.COPY_PROBE,args[1]+'\\n');setTimeout(()=>{},750);}else if(args.includes('pg_dump')){process.stdout.write('SYNTHETIC_DUMP');}else{process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({installationId:'primary',workspaceId:'synthetic-workspace',initialized:true,migrations:[]})));}`;
  await withFakeDocker(fixture, async (root) => {
    const workspace = path.join(root, "workspace"),
      dot = path.join(workspace, ".townbase"),
      archive = path.join(root, "archives"),
      key = path.join(root, "key"),
      probe = path.join(root, "copies");
    await mkdir(dot, { recursive: true, mode: 0o700 });
    await chmod(dot, 0o700);
    await writeFile(path.join(dot, "compose.env"), "SYNTHETIC_FIXTURE=1\n", {
      mode: 0o600,
    });
    await mkdir(archive, { mode: 0o700 });
    await writeFile(key, Buffer.alloc(32, 7).toString("base64url"), {
      mode: 0o600,
    });
    const preload = path.join(root, "clock.mjs");
    // Scale only the parent's deadlines, never the fake cp's750ms work. A
    // mistaken metadata deadline500ms must fail; a transfer deadline5s must pass.
    await writeFile(
      preload,
      `const timeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timeout(fn,ms===120000?500:ms===1800000?5000:ms,...args);`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        path.resolve("deployment/backup.mjs"),
        "create",
        "--project=townbase-copy-deadline-test",
        "--key-file=" + key,
        "--directory=" + archive,
      ],
      {
        cwd: workspace,
        env: { ...process.env, COPY_PROBE: probe },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const copies = (await readFile(probe, "utf8")).trim().split("\n");
    assert.equal(copies.length, 2);
    assert(copies.some((v) => v.endsWith("/documents/.")));
    assert(copies.some((v) => v.endsWith("/operations/deletions/.")));
    assert.equal(
      JSON.parse(result.stdout).temporaryAttachmentBodiesIncluded,
      false,
    );
  });
});

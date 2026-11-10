import assert from "node:assert/strict";
import test from "node:test";
import { runLockDiagnostic } from "../../docs/implementation/evidence/v0.2-first-use-chat/lock-recycling-runner.mjs";

for (const busy of [0, 1]) {
  test(`diagnostic aborts on busy lock ${busy} without publishing samples and closes clients`, async () => {
    const clients = [],
      samples = [];
    let waits = 0;
    const create = () => {
      const index = clients.length;
      const client = {
        disconnected: false,
        $queryRaw: async () => [{ pid: 100 + index, acquired: index !== busy }],
        $disconnect: async () => {
          client.disconnected = true;
        },
      };
      clients.push(client);
      return client;
    };
    await assert.rejects(
      runLockDiagnostic(create, {
        wait: async () => {
          waits++;
        },
        publish: (sample) => samples.push(sample),
      }),
      /TOWNBASE_DIAGNOSTIC_LOCK_BUSY/,
    );
    assert.equal(waits, 0);
    assert.deepEqual(samples, []);
    assert.equal(clients.length, busy + 1);
    assert.ok(clients.every((c) => c.disconnected));
  });
}
test("successful lock acquisition precedes all samples and clients are closed", async () => {
  const clients = [],
    samples = [];
  let waits = 0;
  const create = () => {
    const client = {
      disconnected: false,
      $queryRaw: async (strings) =>
        strings[0].includes("pg_try_advisory_lock")
          ? [{ pid: 100 + clients.length, acquired: true }]
          : [{ pid: 100 + clients.length, owned: true }],
      $disconnect: async () => {
        client.disconnected = true;
      },
    };
    clients.push(client);
    return client;
  };
  await runLockDiagnostic(create, {
    wait: async () => {
      waits++;
    },
    publish: (sample) => samples.push(sample),
  });
  assert.equal(waits, 16);
  assert.equal(samples.length, 34);
  assert.ok(samples.slice(0, 2).every((s) => s.acquired[0].acquired));
  assert.ok(samples.slice(2).every((s) => s.rows[0].owned));
  assert.ok(clients.every((c) => c.disconnected));
});

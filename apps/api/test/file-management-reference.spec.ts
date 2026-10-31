import { createHash } from "node:crypto";
import { FileManagementService } from "../src/files/file-management.service";
import { FileError } from "../src/files/file-contract";
import type { DeploymentDatabase } from "../src/deployment/deployment-database";
import type { AuthService, AuthTransaction } from "../src/auth/auth.service";
import type { FileStorage } from "../src/files/file-storage";
import type { FileExtractor } from "../src/files/file-extractor";

const id = "11111111-1111-4111-8111-111111111111";
const version = {
  id,
  rawDeletedAt: null,
  documentStatus: "active",
  storageKey: id + ".bin",
  byteSize: 1,
  contentHash: createHash("sha256").update("x").digest("hex"),
  fileName: "a.txt",
};
const context = {
  installationId: "primary",
  administratorId: "admin",
  workspaceId: "workspace",
  username: "admin",
  expiresAt: "2030-01-01T00:00:00.000Z",
};
function fixture(next: unknown, bytes?: Buffer, revoked = false) {
  const findFirst = jest
    .fn()
    .mockResolvedValueOnce({
      excludedAt: null,
      scopeRevision: 1,
      versions: [version],
    })
    .mockResolvedValue(
      next == null
        ? next
        : { excludedAt: null, scopeRevision: 1, ...(next as object) },
    );
  const error = new FileError("storage_unavailable");
  const read = bytes
    ? jest.fn().mockResolvedValue(bytes)
    : jest.fn().mockRejectedValue(error);
  let calls = 0;
  const authorizedOperation = jest.fn(async (_token, _expected, work) => {
    if (++calls === 2 && revoked) return { ok: false };
    return {
      ok: true,
      ...(await work(
        { fileOriginal: { findFirst } } as unknown as AuthTransaction,
        context,
      )),
    };
  });
  const service = new FileManagementService(
    {} as DeploymentDatabase,
    { authorizedOperation } as unknown as AuthService,
    { read } as unknown as FileStorage,
    {} as FileExtractor,
  );
  return { service, read, error, authorizedOperation, findFirst };
}
describe("D02 source read failure rechecks current access", () => {
  test("a concurrently deleted row returns404 instead of a storage failure", async () => {
    const f = fixture(null);
    await expect(
      f.service.reference("token", context, id),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.authorizedOperation).toHaveBeenCalledTimes(2);
    expect(f.findFirst.mock.calls[1]?.[0].where).toMatchObject({
      installationId: "primary",
      ownerAdministratorId: "admin",
      deletedAt: null,
    });
  });
  test("an unchanged current row preserves the original storage failure", async () => {
    const f = fixture({ versions: [version] });
    await expect(f.service.reference("token", context, id)).rejects.toBe(
      f.error,
    );
    expect(f.authorizedOperation).toHaveBeenCalledTimes(2);
  });
  test.each([
    { ...version, id: "22222222-2222-4222-8222-222222222222" },
    { ...version, rawDeletedAt: new Date() },
  ])(
    "a replaced/removed version is unavailable after failed I/O",
    async (latest) => {
      const f = fixture({ versions: [latest] });
      await expect(
        f.service.reference("token", context, id),
      ).rejects.toMatchObject({ status: 404 });
    },
  );
  test("revoked identity is rechecked even when disk read fails", async () => {
    const f = fixture({ versions: [version] }, undefined, true);
    await expect(
      f.service.reference("token", context, id),
    ).rejects.toMatchObject({ status: 401 });
  });
  test("hash corruption on a current row remains a storage failure", async () => {
    const f = fixture({ versions: [version] }, Buffer.from("y"));
    await expect(
      f.service.reference("token", context, id),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(f.authorizedOperation).toHaveBeenCalledTimes(2);
  });
  test("a successful read still rejects a concurrent deletion", async () => {
    const f = fixture(null, Buffer.from("x"));
    await expect(
      f.service.reference("token", context, id),
    ).rejects.toMatchObject({ status: 404 });
  });
  test("scope changed during a successful read rejects a previously bound reference", async () => {
    const f = fixture(
      { versions: [version], scopeRevision: 3 },
      Buffer.from("x"),
    );
    await expect(
      f.service.reference("token", context, id, {
        versionId: id,
        scopeRevision: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  test("a stale bound reference is rejected before reading raw bytes", async () => {
    const f = fixture({ versions: [version] }, Buffer.from("x"));
    await expect(
      f.service.reference("token", context, id, {
        versionId: id,
        scopeRevision: 2,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.read).not.toHaveBeenCalled();
  });
  test("scope exclusion wins over a failed disk read", async () => {
    const f = fixture({ versions: [version], excludedAt: new Date() });
    await expect(
      f.service.reference("token", context, id),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.read).toHaveBeenCalledTimes(1);
  });
});

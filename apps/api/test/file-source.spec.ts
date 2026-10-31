import type { Prisma } from "@townbase/database";
import {
  assertFileSourcesCurrent,
  type FileSource,
} from "../src/files/file-source";
import type { AdministratorContext } from "../src/auth/auth.service";
const source: FileSource = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  indexId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  originalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  versionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  scopeRevision: 1,
};
const context = {
  installationId: "primary",
  administratorId: "owner",
} as AdministratorContext;
describe("D05 source admission input boundary", () => {
  test.each(
    [
      undefined,
      null,
      [],
      Array(1),
      Array(21).fill(source),
      [null],
      [{ ...source, id: "invalid" }],
      [{ ...source, scopeRevision: 0 }],
      [{ ...source, scopeRevision: 2147483648 }],
      [{ ...source, scopeRevision: 1.5 }],
      [source, { ...source, id: source.id.toUpperCase() }],
    ].map((value) => ({ value })),
  )("rejects invalid identities before querying DB", async ({ value }) => {
    const query = jest.fn();
    await expect(
      assertFileSourcesCurrent(
        { $queryRaw: query } as unknown as Prisma.TransactionClient,
        context,
        value as FileSource[],
      ),
    ).rejects.toMatchObject({ code: "invalid_file_sources" });
    expect(query).not.toHaveBeenCalled();
  });
  test("a missing or invalidated source is a conflict, not an empty success", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ count: 0n }]),
    } as unknown as Prisma.TransactionClient;
    await expect(
      assertFileSourcesCurrent(tx, context, [source]),
    ).rejects.toMatchObject({ code: "source_changed" });
  });
});

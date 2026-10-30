import { assertFreshFileManagementDatabase } from "./file-management-fixture";
const tables = [
  "installation",
  "fileOriginal",
  "modelCall",
  "document",
  "documentChunk",
] as const;
function fixture(nonEmpty?: string) {
  const db = Object.fromEntries(
    tables.map((table) => [
      table,
      { count: jest.fn().mockResolvedValue(table === nonEmpty ? 1 : 0) },
    ]),
  );
  return db as unknown as Parameters<
    typeof assertFreshFileManagementDatabase
  >[0];
}
describe("D02 fixture preconditions", () => {
  test("empty tables pass without requiring the migration workspace to be empty", async () => {
    await expect(
      assertFreshFileManagementDatabase(fixture()),
    ).resolves.toBeUndefined();
  });
  test.each(tables)(
    "rejects existing %s independently before fixture writes",
    async (table) => {
      const db = fixture(table);
      await expect(assertFreshFileManagementDatabase(db)).rejects.toThrow(
        "Fresh D02 synthetic DB required; refuse reset",
      );
      for (const name of tables)
        expect(db[name].count).toHaveBeenCalledTimes(1);
    },
  );
});

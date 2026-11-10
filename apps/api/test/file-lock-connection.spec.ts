import { fileLockConnectionUrl } from "../src/files/file-lock-connection";
test("session lock clients disable recycling while retaining bounded queries", () => {
  const u = new URL(
    fileLockConnectionUrl(
      "postgresql://fixture:secret@postgres/test?socket_timeout=3&connect_timeout=3&pool_timeout=3&max_idle_connection_lifetime=1&max_connection_lifetime=1&connection_limit=8",
    ),
  );
  expect(u.searchParams.get("connection_limit")).toBe("1");
  expect(u.searchParams.get("max_idle_connection_lifetime")).toBe("0");
  expect(u.searchParams.get("max_connection_lifetime")).toBe("0");
  expect(u.searchParams.get("socket_timeout")).toBe("3");
  expect(u.searchParams.get("connect_timeout")).toBe("3");
  expect(u.searchParams.get("pool_timeout")).toBe("3");
  expect(
    new URL(fileLockConnectionUrl(u.toString(), true)).searchParams.has(
      "socket_timeout",
    ),
  ).toBe(false);
});

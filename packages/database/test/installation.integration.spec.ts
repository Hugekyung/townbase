import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { assertTestDatabase } from "./test-database-safety";

// Encoded fixture only; not a seeded password or authentication implementation.
const PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c3RvcmFnZS10ZXN0LXNhbHQ$a2V5LWhhc2gtZml4dHVyZS1vbmx5";

describe("installation storage foundation", () => {
  let prisma: PrismaClient;
  let workspaceId: string;

  const installationData = () => ({
    workspaceId,
    name: "Storage test installation",
    timeZone: "Asia/Seoul",
  });

  const administratorData = (username = "operator") => ({
    installationId: "primary",
    username,
    passwordHash: PASSWORD_HASH,
  });

  const auditData = () => ({
    installationId: "primary",
    actorType: "server" as const,
    action: "installation_created" as const,
    outcome: "succeeded" as const,
    requestId: randomUUID(),
  });

  beforeAll(async () => {
    assertTestDatabase();
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  beforeEach(async () => {
    const workspace = await prisma.workspace.create({
      data: { name: `b01-test-${randomUUID()}` },
    });
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    assertTestDatabase();
    await prisma.installationAuditEvent.deleteMany();
    await prisma.administrator.deleteMany();
    await prisma.installation.deleteMany();
    await prisma.workspace.deleteMany({
      where: { name: { startsWith: "b01-test-" } },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("persists setup and typed audit events atomically, then reads them through another connection", async () => {
    const administrator = await prisma.$transaction(async (tx) => {
      await tx.installation.create({ data: installationData() });
      const created = await tx.administrator.create({
        data: administratorData(),
      });
      await tx.installation.update({
        where: { id: "primary" },
        data: { initializedAt: new Date() },
      });
      await tx.installationAuditEvent.create({ data: auditData() });
      await tx.installationAuditEvent.create({
        data: {
          ...auditData(),
          actorType: "administrator",
          actorAdministratorId: created.id,
          action: "installation_settings_changed",
        },
      });
      return created;
    });

    const reader = new PrismaClient();
    try {
      const loaded = await reader.installation.findUniqueOrThrow({
        where: { id: "primary" },
        include: { administrator: true, auditEvents: true, workspace: true },
      });
      expect(loaded.workspace.id).toBe(workspaceId);
      expect(loaded.name).toBe("Storage test installation");
      expect(loaded.timeZone).toBe("Asia/Seoul");
      expect(loaded.initializedAt).not.toBeNull();
      expect(loaded.administrator?.id).toBe(administrator.id);
      expect(loaded.administrator?.passwordHash).toBe(PASSWORD_HASH);
      expect(loaded.auditEvents).toHaveLength(2);
      expect(
        loaded.auditEvents.some(
          (event) => event.actorAdministratorId === administrator.id,
        ),
      ).toBe(true);
    } finally {
      await reader.$disconnect();
    }
  });

  it("rejects a second installation even when it uses a different primary key and workspace", async () => {
    await prisma.installation.create({ data: installationData() });
    const other = await prisma.workspace.create({
      data: { name: `b01-test-${randomUUID()}` },
    });
    await expect(
      prisma.installation.create({
        data: { ...installationData(), id: "another", workspaceId: other.id },
      }),
    ).rejects.toThrow("Installation_singleton_check");
    expect(await prisma.installation.count()).toBe(1);
    expect(
      await prisma.workspace.findUnique({ where: { id: other.id } }),
    ).not.toBeNull();
  });

  it("allows only one administrator when registrations race", async () => {
    await prisma.installation.create({ data: installationData() });
    const results = await Promise.allSettled([
      prisma.administrator.create({ data: administratorData("first") }),
      prisma.administrator.create({ data: administratorData("second") }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "P2002" });
    expect(await prisma.administrator.count()).toBe(1);
  });

  it("rejects a nonexistent ownership link", async () => {
    await expect(
      prisma.installation.create({
        data: { ...installationData(), workspaceId: "missing-workspace" },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    expect(await prisma.installation.count()).toBe(0);
  });

  it.each([
    { actorType: "administrator" as const, actorAdministratorId: null },
    { actorType: "server" as const, actorAdministratorId: "missing-admin" },
  ])(
    "rejects inconsistent audit actor $actorType/$actorAdministratorId",
    async (actor) => {
      await prisma.installation.create({ data: installationData() });
      await expect(
        prisma.installationAuditEvent.create({
          data: { ...auditData(), ...actor },
        }),
      ).rejects.toThrow("InstallationAuditEvent_actor_check");
      expect(await prisma.installationAuditEvent.count()).toBe(0);
    },
  );

  it("rejects an audit actor that does not belong to the installation", async () => {
    await prisma.installation.create({ data: installationData() });
    await expect(
      prisma.installationAuditEvent.create({
        data: {
          ...auditData(),
          actorType: "administrator",
          actorAdministratorId: "missing-admin",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it.each(["", "ordinary-plaintext-password"])(
    "rejects unencoded password storage: %s",
    async (passwordHash) => {
      await prisma.installation.create({ data: installationData() });
      await expect(
        prisma.administrator.create({
          data: { ...administratorData(), passwordHash },
        }),
      ).rejects.toThrow("Administrator_passwordHash_check");
      expect(await prisma.administrator.count()).toBe(0);
    },
  );

  it("rolls back ownership and administrator creation when audit persistence fails", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.installation.create({ data: installationData() });
        await tx.administrator.create({ data: administratorData() });
        await tx.installationAuditEvent.create({
          data: { ...auditData(), requestId: " " },
        });
      }),
    ).rejects.toThrow("InstallationAuditEvent_requestId_check");
    expect(await prisma.installation.count()).toBe(0);
    expect(await prisma.administrator.count()).toBe(0);
    expect(await prisma.installationAuditEvent.count()).toBe(0);
    expect(
      await prisma.workspace.findUnique({ where: { id: workspaceId } }),
    ).not.toBeNull();
  });

  it("blocks ownership deletion instead of cascading into legacy data or audit history", async () => {
    await prisma.installation.create({ data: installationData() });
    const administrator = await prisma.administrator.create({
      data: administratorData(),
    });
    await prisma.installationAuditEvent.create({
      data: {
        ...auditData(),
        actorType: "administrator",
        actorAdministratorId: administrator.id,
      },
    });
    await expect(
      prisma.workspace.delete({ where: { id: workspaceId } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.installation.delete({ where: { id: "primary" } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.administrator.delete({ where: { id: administrator.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    expect(
      await prisma.workspace.findUnique({ where: { id: workspaceId } }),
    ).not.toBeNull();
    expect(await prisma.installationAuditEvent.count()).toBe(1);
  });
});

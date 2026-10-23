import { readFileSync } from "node:fs";

// B02 exposes only readiness reads. Future features must grant their own tables
// explicitly rather than giving the API schema ownership or migration powers.
export async function configureRuntimeRole(tx, env = process.env) {
  if (!env.TOWNBASE_RUNTIME_PASSWORD_FILE)
    throw new Error("Runtime database secret file is required");
  const password = readFileSync(
    env.TOWNBASE_RUNTIME_PASSWORD_FILE,
    "utf8",
  ).trim();
  if (password.length < 32)
    throw new Error("Runtime database secret is invalid");
  const roles =
    await tx.$queryRaw`SELECT 1 FROM pg_roles WHERE rolname = 'townbase_runtime'`;
  if (roles.length === 0)
    await tx.$executeRaw`CREATE ROLE townbase_runtime LOGIN`;
  // PostgreSQL quotes the password as a literal. Never log the resulting SQL.
  const [statement] =
    await tx.$queryRaw`SELECT format('ALTER ROLE townbase_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L', ${password}) AS sql`;
  await tx.$executeRawUnsafe(statement.sql);
  const memberships =
    await tx.$queryRaw`SELECT format('REVOKE %I FROM townbase_runtime', parent.rolname) AS sql FROM pg_auth_members member JOIN pg_roles parent ON parent.oid = member.roleid JOIN pg_roles child ON child.oid = member.member WHERE child.rolname = 'townbase_runtime'`;
  for (const membership of memberships)
    await tx.$executeRawUnsafe(membership.sql);
  await tx.$executeRaw`REVOKE CREATE ON SCHEMA public FROM PUBLIC`;
  await tx.$executeRaw`REVOKE ALL ON SCHEMA public FROM townbase_runtime`;
  await tx.$executeRaw`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM townbase_runtime`;
  await tx.$executeRaw`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM townbase_runtime`;
  const [databaseGrants] = await tx.$queryRaw`SELECT
    format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) AS revoke_public,
    format('REVOKE ALL ON DATABASE %I FROM townbase_runtime', current_database()) AS revoke_runtime,
    format('GRANT CONNECT ON DATABASE %I TO townbase_runtime', current_database()) AS grant_connect`;
  for (const sql of Object.values(databaseGrants))
    await tx.$executeRawUnsafe(sql);
  await tx.$executeRaw`GRANT USAGE ON SCHEMA public TO townbase_runtime`;
  await tx.$executeRaw`GRANT SELECT ON "_prisma_migrations", "Installation", "Administrator", "InstallationAuditEvent" TO townbase_runtime`;
}

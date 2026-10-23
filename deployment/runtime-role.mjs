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
  // The PUBLIC schema/database DDL revokes above are intentional. Object and
  // default ACLs belonging to other consumers are inspected, not auto-rewritten.
  // Only public's four readiness tables and invoker routines installed by the
  // required vector extension are allowed outside PostgreSQL system schemas.
  const [grants] = await tx.$queryRaw`SELECT
    has_schema_privilege('townbase_runtime', 'public', 'CREATE')
    OR has_database_privilege('townbase_runtime', current_database(), 'CREATE,TEMPORARY')
    OR EXISTS (
      SELECT 1 FROM pg_namespace n
      WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('public', 'information_schema')
      AND has_schema_privilege('townbase_runtime', n.oid, 'USAGE,CREATE')
    )
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE CASE WHEN n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f') THEN (
        has_table_privilege('townbase_runtime', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege('townbase_runtime', c.oid, 'INSERT,UPDATE,REFERENCES')
        OR has_table_privilege('townbase_runtime', c.oid, 'SELECT WITH GRANT OPTION')
        OR has_any_column_privilege('townbase_runtime', c.oid, 'SELECT WITH GRANT OPTION')
        OR ((n.nspname <> 'public' OR c.relname NOT IN ('_prisma_migrations', 'Installation', 'Administrator', 'InstallationAuditEvent'))
          AND (has_table_privilege('townbase_runtime', c.oid, 'SELECT')
            OR has_any_column_privilege('townbase_runtime', c.oid, 'SELECT')))
      ) ELSE false END
    )
    OR EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE CASE WHEN n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind = 'S'
        THEN has_sequence_privilege('townbase_runtime', c.oid, 'SELECT,USAGE,UPDATE')
        ELSE false END
    )
    OR EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND has_function_privilege('townbase_runtime', p.oid, 'EXECUTE')
      AND (p.prosecdef OR NOT EXISTS (
        SELECT 1 FROM pg_depend dep JOIN pg_extension ext ON ext.oid = dep.refobjid
        WHERE dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid
        AND dep.refclassid = 'pg_extension'::regclass AND dep.deptype = 'e'
        AND ext.extname = 'vector'
      ))
    )
    OR EXISTS (
      SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
      WHERE d.defaclobjtype IN ('r', 'S', 'f', 'n')
      AND (d.defaclnamespace = 0 OR (n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'))
      AND acl.grantee IN (0, (SELECT oid FROM pg_roles WHERE rolname = 'townbase_runtime'))
    ) AS unsafe`;
  if (grants.unsafe) {
    throw Object.assign(new Error("Unsafe runtime database privileges"), {
      code: "TOWNBASE_UNSAFE_RUNTIME_GRANTS",
    });
  }
}

import "reflect-metadata";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { AuthService } from "./auth.service";
import { RECOVERY_TTL_MS } from "./auth-policy";
async function issue() {
  const database = new DeploymentDatabase();
  try {
    await new AuthService(database).issueRecovery();
    console.log(
      `Recovery token file prepared. Read it through the protected server-local path. Expires in ${RECOVERY_TTL_MS / 60000} minutes.`,
    );
  } finally {
    await database.onApplicationShutdown();
  }
}
void issue().catch(() => {
  console.error(
    "Recovery issuance failed. Check initialized administrator, protected storage and database.",
  );
  process.exitCode = 1;
});

import "reflect-metadata";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { BOOTSTRAP_TTL_MINUTES } from "./setup-policy";
import { issuanceFailure } from "./issue-error";
import { SetupService } from "./setup.service";

async function issue() {
  const database = new DeploymentDatabase();
  try {
    await new SetupService(database).issue();
    console.log(
      `Bootstrap token file prepared. Read it through the protected server-local path. Expires in ${BOOTSTRAP_TTL_MINUTES} minutes.`,
    );
  } finally {
    await database.onApplicationShutdown();
  }
}
void issue().catch((error: unknown) => {
  console.error(issuanceFailure(error));
  process.exitCode = 1;
});

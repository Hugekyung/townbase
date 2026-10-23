import "reflect-metadata";
import { DeploymentDatabase } from "../deployment/deployment-database";
import { SetupService } from "./setup.service";

async function issue() {
  const database = new DeploymentDatabase();
  try {
    await new SetupService(database).issue();
    console.log(
      "Bootstrap token file prepared. Read it through the protected server-local path. Expires in 60 minutes.",
    );
  } finally {
    await database.onApplicationShutdown();
  }
}
void issue().catch(() => {
  console.error(
    "Bootstrap issuance failed. Check setup state, storage and database. Existing initialization was not bypassed.",
  );
  process.exitCode = 1;
});

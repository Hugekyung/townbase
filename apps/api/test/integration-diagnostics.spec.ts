import { CredentialStorageError } from "../src/model-integration/credential-vault";
import { integrationFailureCode } from "../src/model-integration/model-integration.controller";
it.each([
  [
    new CredentialStorageError("master_key_unavailable"),
    "master_key_unavailable",
  ],
  [
    new CredentialStorageError("credential_unavailable"),
    "credential_unavailable",
  ],
  [
    { code: null, errorCode: "P1001", message: "secret-canary" },
    "database_unavailable",
  ],
  [{ code: "P1002" }, "database_unavailable"],
  [{ code: "P1008" }, "database_transaction_unavailable"],
  [{ errorCode: "P2028" }, "database_transaction_unavailable"],
  [{ code: "P2024", errorCode: "P1001" }, "database_transaction_unavailable"],
  [{ code: "secret-canary", message: "secret-canary" }, "storage_unavailable"],
  [undefined, "storage_unavailable"],
  [new Error("secret-canary"), "storage_unavailable"],
  [{ errorCode: "P1017" }, "database_unavailable"],
])(
  "reports only fixed integration diagnostic codes for %p",
  (error, expected) => {
    expect(integrationFailureCode(error)).toBe(expected);
    expect(integrationFailureCode(error)).not.toContain("secret-canary");
  },
);

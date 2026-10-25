import {
  DEFAULT_TRANSFERS,
  inspectTransfer,
  OPENAI_ENDPOINTS,
} from "../src/model-integration/transfer-policy";
describe("local outbound preflight", () => {
  const allowed = { documentEmbedding: true, rag: true, attachment: true };
  it.each([
    "document_embedding",
    "rag_question_embedding",
    "rag_answer",
    "attachment_answer",
  ] as const)("denies unconfigured purpose %s", (purpose) => {
    expect(() =>
      inspectTransfer(
        DEFAULT_TRANSFERS,
        purpose,
        OPENAI_ENDPOINTS.answer,
        "Synthetic text",
      ),
    ).toThrow("transfer_not_allowed");
  });
  it("keeps each permission independent, including question embedding vs attachments", () => {
    const flags = { documentEmbedding: true, rag: false, attachment: false };
    expect(() =>
      inspectTransfer(
        flags,
        "document_embedding",
        OPENAI_ENDPOINTS.embedding,
        "Synthetic text",
      ),
    ).not.toThrow();
    expect(() =>
      inspectTransfer(
        flags,
        "rag_question_embedding",
        OPENAI_ENDPOINTS.embedding,
        "Synthetic text",
      ),
    ).toThrow("transfer_not_allowed");
    expect(() =>
      inspectTransfer(
        flags,
        "attachment_answer",
        OPENAI_ENDPOINTS.answer,
        "Synthetic text",
      ),
    ).toThrow("transfer_not_allowed");
  });
  it.each([
    "https://evil.test/v1/responses",
    "http://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses?redirect=1",
    "https://api.openai.com@evil.test/v1/responses",
    "https://api.openai.com/v1/embeddings",
    "https://api.openai.com/v1/responses/",
  ])("denies endpoint deviations %s", (endpoint) => {
    expect(() =>
      inspectTransfer(allowed, "rag_answer", endpoint, "Safe text"),
    ).toThrow("unsupported_endpoint");
  });
  it.each([
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----",
    "sk-proj-synthetic-canary-1234567890",
    "ghp_12345678901234567890",
    "github_pat_12345678901234567890",
    "xoxb-1234567890-1234567890",
    "OPENAI_API_KEY=private-value",
    "API_KEY=\nprivate-value",
    "API_KEY=\r\nprivate-value",
    "export\vAPI_KEY=private-value",
    "export\fAPI_KEY=private-value",
    "\v\fAPI_KEY=private-value",
    "API_KEY\v=private-value",
    "API_KEY\f=private-value",
    "API_KEY=\v\fprivate-value",
    "API_KEY\n=\nprivate-value",
    "export\nAPI_KEY=private-value",
    "export DATABASE_PASSWORD=private-value",
    "\t export\t SERVICE_TOKEN \t=\tprivate-value",
    "public text\r\n  API_KEY = private-value",
    "sk-\u200bproj-synthetic-canary-1234567890",
  ])(
    "blocks secret patterns locally without returning the value: %p",
    (text) => {
      expect(() =>
        inspectTransfer(allowed, "rag_answer", OPENAI_ENDPOINTS.answer, text),
      ).toThrow("sensitive_content");
    },
  );
  it.each([
    ".env",
    "/tmp/.env.production",
    "C:\\tmp\\.env",
    "id_ed25519",
    "private.pem",
    "secret.KEY",
    "credentials.json",
  ])("blocks secret files %s", (fileName) => {
    expect(() =>
      inspectTransfer(
        allowed,
        "document_embedding",
        OPENAI_ENDPOINTS.embedding,
        "Safe text",
        [fileName],
      ),
    ).toThrow("sensitive_content");
  });
  it("requires nonempty typed content, known purposes and explicit booleans", () => {
    for (const text of [undefined, null, "", "   "])
      expect(() =>
        inspectTransfer(
          allowed,
          "rag_answer",
          OPENAI_ENDPOINTS.answer,
          text as never,
        ),
      ).toThrow("invalid_transfer_input");
    expect(() =>
      inspectTransfer(
        allowed,
        "unknown" as never,
        OPENAI_ENDPOINTS.answer,
        "Safe",
      ),
    ).toThrow("invalid_transfer_input");
    expect(() =>
      inspectTransfer(
        { ...allowed, rag: "true" as never },
        "rag_answer",
        OPENAI_ENDPOINTS.answer,
        "Safe",
      ),
    ).toThrow("transfer_not_allowed");
  });
});

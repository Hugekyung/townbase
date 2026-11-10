import "reflect-metadata";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const built = createRequire(__filename);
if (
  process.env.TOWNBASE_SYNTHETIC_BROWSER !== "1" ||
  process.env.NODE_ENV === "production"
)
  throw Error("Explicit synthetic browser fixture required");
const { databaseEnvironment } = built("../../../deployment/database-env.mjs");
process.env.DATABASE_URL = databaseEnvironment();
const fixtureUrl = new URL(process.env.DATABASE_URL);
if (
  fixtureUrl.hostname !== "postgres" ||
  fixtureUrl.pathname !== "/townbase_browser_test"
)
  throw Error("Dedicated browser test DB required");
process.env.TOWNBASE_RUNTIME_PROFILE = "self_hosted";
for (const name of [
  "DOCUMENTS",
  "ATTACHMENTS",
  "BOOTSTRAP",
  "RECOVERY",
  "OPERATIONS",
]) {
  process.env["TOWNBASE_" + name + "_PATH"] =
    "/var/lib/townbase/" + name.toLowerCase();
}
process.env.TOWNBASE_MASTER_KEY_FILE = "/run/secrets/model_master_key";
const { Test } = built("@nestjs/testing"),
  { DeploymentModule } = built("../dist/deployment/deployment.module"),
  { OpenAIProvider } = built("../dist/model-integration/openai-provider"),
  { SetupService } = built("../dist/setup/setup.service"),
  { DeploymentDatabase } = built("../dist/deployment/deployment-database"),
  { configureSelfHostedHttp, configureSelfHostedStaticAssets } = built(
    "../dist/deployment/self-hosted-http",
  );
const provider = {
  call: async (
    _key: string,
    r: { model: string; input: string },
    signal: AbortSignal,
  ) => {
    if (signal.aborted) throw new Error("cancelled");
    const delay = Number(process.env.TOWNBASE_SYNTHETIC_BROWSER_DELAY_MS ?? 0);
    if (!Number.isInteger(delay) || delay < 0 || delay > 15000)
      throw Error("Invalid synthetic delay");
    if (delay && r.model !== "text-embedding-3-small")
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(
            Object.assign(new Error("synthetic cancelled"), {
              name: "AbortError",
            }),
          );
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, delay);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    const embedding = r.model === "text-embedding-3-small",
      usage = {
        input: 20,
        cached: 0,
        write30: 0,
        write12: 0,
        output: embedding ? 0 : 40,
        reasoning: 0,
      };
    if (embedding)
      return {
        usage,
        providerId: "synthetic-browser",
        outcome: "succeeded",
        embedding: Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)),
      };
    let text = "OK";
    try {
      const input = JSON.parse(r.input);
      const s = input.sources[0];
      const v2 =
        r.format?.name === "townbase_rag_grounded_v2" ? { followUps: [] } : {};
      text = JSON.stringify(
        s
          ? {
              ...v2,
              isAnswerable: true,
              reason: "",
              claims: [
                {
                  text: s.content,
                  evidence: [
                    { sourceId: s.id, quote: s.content.slice(0, 100) },
                  ],
                },
              ],
              conflicts: [],
            }
          : {
              ...v2,
              isAnswerable: false,
              reason: "합성 문서의 근거가 없어요.",
              claims: [],
              conflicts: [],
            },
      );
    } catch {}
    return {
      usage,
      providerId: "synthetic-browser",
      outcome: "succeeded",
      text,
    };
  },
};
let stage = "directories";
async function main() {
  for (const name of [
    "DOCUMENTS",
    "ATTACHMENTS",
    "BOOTSTRAP",
    "RECOVERY",
    "OPERATIONS",
  ])
    await mkdir(process.env["TOWNBASE_" + name + "_PATH"]!, {
      recursive: true,
      mode: 0o700,
    });
  stage = "module";
  const module = await Test.createTestingModule({ imports: [DeploymentModule] })
    .overrideProvider(OpenAIProvider)
    .useValue(provider)
    .compile();
  const app = module.createNestApplication({
    bodyParser: false,
    logger: false,
  });
  app.enableShutdownHooks();
  configureSelfHostedHttp(app);
  configureSelfHostedStaticAssets(
    app,
    path.resolve(__dirname, "../../web/dist"),
  );
  stage = "initialize";
  await app.init();
  const db = app.get(DeploymentDatabase);
  const install = await db.prisma.installation.findFirst();
  if (
    install &&
    install.name !== "townbase" &&
    install.name !== "Synthetic browser and recovery"
  )
    throw Error("Unrecognized synthetic installation");
  stage = "bootstrap-token";
  if ((await app.get(SetupService).status()).state === "required")
    await app.get(SetupService).issue();
  // This guarded fixture runs inside an isolated Docker network. The host browser
  // reaches only the Compose loopback publication (127.0.0.1:3101). Binding this
  // container socket to127.0.0.1 would prevent that connection; do not publish it
  // on a host wildcard interface or run it against an ordinary installation.
  await app.listen(3000, "0.0.0.0");
  console.log("TOWNBASE_SYNTHETIC_BROWSER_READY");
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      stage,
      name: e.name,
      code: e.code ?? null,
      frames: String(e.stack ?? "")
        .split("\n")
        .slice(1, 3),
    }),
  );
  console.error("TOWNBASE_SYNTHETIC_BROWSER_FAILED");
  process.exit(1);
});

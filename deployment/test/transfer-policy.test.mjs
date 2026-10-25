import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("transfer inspection handles long whitespace and still detects the following secret", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const preload = fileURLToPath(new URL("./deny-network.cjs", import.meta.url));
  const script = `
    const assert=require('node:assert/strict');
    const {inspectTransfer,OPENAI_ENDPOINTS}=require('./apps/api/dist/model-integration/transfer-policy.js');
    const flags={documentEmbedding:true,rag:true,attachment:true};
    for(const prefix of ['\\n'.repeat(200000),'\\r\\n'.repeat(100000),' \\t'.repeat(100000)]){
      inspectTransfer(flags,'rag_answer',OPENAI_ENDPOINTS.answer,prefix+'ordinary document text');
      assert.throws(()=>inspectTransfer(flags,'rag_answer',OPENAI_ENDPOINTS.answer,prefix+'OPENAI_API_KEY=synthetic-value'),error=>error.code==='sensitive_content');
    }
  `;
  const result = spawnSync(
    process.execPath,
    ["--require", preload, "-e", script],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

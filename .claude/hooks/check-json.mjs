// PostToolUse(Edit|Write): report a .json file that no longer parses.
// Repository .json files are strict JSON (no comments or trailing commas);
// add an explicit exemption here if a JSONC file is ever introduced.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runHook } from "./hook-input.mjs";

export async function checkJson(input) {
  const file = input.tool_response?.filePath ?? input.tool_input?.file_path;
  if (typeof file !== "string" || !file.endsWith(".json")) return "";
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return `CLAUDE_HOOK_JSON_READ_FAILED: ${file}`;
  }
  try {
    JSON.parse(text);
    return "";
  } catch {
    return `JSON parse failed: ${file}`;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runHook(checkJson);

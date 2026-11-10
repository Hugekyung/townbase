// PostToolUse(Edit|Write): report a .json file that no longer parses.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { runHook } from "./hook-input.mjs";

export async function checkJson(input) {
  const file = input.tool_response?.filePath ?? input.tool_input?.file_path;
  if (typeof file !== "string" || !file.endsWith(".json")) return "";
  try {
    JSON.parse(await readFile(file, "utf8"));
    return "";
  } catch {
    return `JSON parse failed: ${file}`;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runHook(checkJson);

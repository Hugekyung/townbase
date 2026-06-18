import type { PromptContext, PromptContextInput } from "./prompt-contract";
import { summarizeTraceSources } from "./prompt-templates";

export const buildPromptContext = (input: PromptContextInput): PromptContext => ({
  question: input.question,
  requestedMode: input.requestedMode,
  resolvedMode: input.resolvedMode,
  sourceCount: input.sources.length,
  sourceSummary: summarizeTraceSources(input.sources),
  sourceCitations: input.sources.map(
    (source) =>
      `${source.rank}. ${source.title}` +
      `${source.filePath == null ? "" : ` — ${source.filePath}`}` +
      `${source.sourceUrl == null ? "" : ` — ${source.sourceUrl}`}` +
      `${source.headingPath.length === 0 ? "" : ` — ${source.headingPath.join(" > ")}`}`,
  ),
});

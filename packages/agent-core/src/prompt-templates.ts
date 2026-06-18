import type { PromptResolvedMode, PromptTraceSource } from "./prompt-contract";

export const COMMON_SYSTEM_PROMPT = [
  "You are Workspace Knowledge Agent.",
  "Answer in Korean unless the user explicitly requests another language.",
  "Be source-grounded and avoid unsupported speculation.",
].join(" ");

export const ONBOARDING_PROMPT = [
  "Focus on learning order, setup, architecture, and the first documents to read.",
  "Prefer practical steps and repo/document pointers.",
].join(" ");

export const PRODUCT_HISTORY_PROMPT = [
  "Focus on decision background, design tradeoffs, and change history.",
  "Prefer chronology and explicit references to the documents that explain the decision.",
].join(" ");

export const DOCUMENTATION_GAP_PROMPT = [
  "Focus on repeated unanswered questions, missing documentation, and concrete gap candidates.",
  "Summarize what is missing and what should be written next.",
].join(" ");

export const FALLBACK_PROMPT = [
  "Use this when the traced sources are too weak or too sparse to answer confidently.",
  "Explain why the answer is not fully supported and what evidence is missing.",
].join(" ");

export const resolvePromptTemplate = (
  mode: PromptResolvedMode,
  sourceCount: number,
): string => {
  if (mode === "change_impact" || sourceCount === 0) {
    return FALLBACK_PROMPT;
  }

  switch (mode) {
    case "onboarding":
      return ONBOARDING_PROMPT;
    case "product_history":
      return PRODUCT_HISTORY_PROMPT;
    case "documentation_gap":
      return DOCUMENTATION_GAP_PROMPT;
  }
};

export const isFallbackPrompt = (sourceCount: number, confidence: number): boolean =>
  sourceCount === 0 || confidence < 0.5;

export const summarizeTraceSources = (sources: readonly PromptTraceSource[]): string =>
  sources.length === 0
    ? "No traced sources."
    : sources
        .map(
          (source) =>
            `[${source.rank}] ${source.title} (${source.sourceType})` +
            `${source.filePath === null ? "" : ` file:${source.filePath}`}` +
            `${source.sourceUrl === null ? "" : ` url:${source.sourceUrl}`}` +
            `${source.headingPath.length === 0 ? "" : ` heading:${source.headingPath.join(" > ")}`}` +
            `${source.sectionTitle === null ? "" : ` section:${source.sectionTitle}`}` +
            ` score:${source.score.toFixed(2)}`,
        )
        .join("\n");

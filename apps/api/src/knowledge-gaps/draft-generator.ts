import type { PromptTraceSource } from "@townbase/agent-core";

import type { KnowledgeGapListRow } from "@townbase/database";

export const DRAFT_GENERATION_TYPES = [
  "github_issue",
  "markdown_doc",
  "notion_page_text",
] as const;

export type DraftGenerationType = (typeof DRAFT_GENERATION_TYPES)[number];

export const DRAFT_PERSISTED_TYPES = ["github_issue", "markdown_doc", "notion_page"] as const;

export type DraftPersistedType = (typeof DRAFT_PERSISTED_TYPES)[number];

export type DraftGenerationCandidate = Readonly<{
  requestedType: DraftGenerationType;
  persistedType: DraftPersistedType;
  title: string;
  body: string;
  acceptanceCriteria: readonly string[];
  requiredContent: readonly string[];
  relatedSources: readonly string[];
}>;

export type DraftGenerationInput = Readonly<{
  gap: KnowledgeGapListRow;
  type: DraftGenerationType;
  sources: readonly PromptTraceSource[];
}>;

const normalizeDraftType = (type: DraftGenerationType): DraftPersistedType =>
  type === "notion_page_text" ? "notion_page" : type;

const formatSourceReference = (source: PromptTraceSource): string => {
  const reference = source.filePath ?? source.sourceUrl ?? source.documentId;
  const heading = source.sectionTitle ?? (source.headingPath.length > 0 ? source.headingPath.join(" > ") : null);
  const sourceLabel = `${source.title}${heading === null ? "" : ` — ${heading}`}`;

  return reference === null ? sourceLabel : `${sourceLabel} (${reference})`;
};

const buildAcceptanceCriteria = (gap: KnowledgeGapListRow, type: DraftGenerationType): readonly string[] => [
  `Describe the gap: ${gap.title}.`,
  `Include the related mode (${gap.relatedMode}) and priority (${gap.priority}).`,
  type === "github_issue"
    ? "Keep the output concise enough to paste directly into GitHub Issue."
    : "Keep the output copy-friendly and ready to paste without reformatting.",
];

const buildRequiredContent = (gap: KnowledgeGapListRow, type: DraftGenerationType): readonly string[] => [
  `Gap description: ${gap.description ?? gap.title}`,
  `Suggested document title: ${gap.suggestedDocumentTitle}`,
  `Suggested markdown path: ${gap.suggestedMarkdownPath}`,
  `Suggested issue title: ${gap.suggestedGithubIssueTitle}`,
  `Draft type: ${type}`,
];

const buildBodySections = (
  gap: KnowledgeGapListRow,
  type: DraftGenerationType,
  sources: readonly PromptTraceSource[],
): string[] => {
  const heading =
    type === "github_issue"
      ? `# ${gap.suggestedGithubIssueTitle}`
      : type === "markdown_doc"
        ? `# ${gap.suggestedDocumentTitle}`
        : `${gap.suggestedDocumentTitle}`;

  const summaryLines = [
    `Gap: ${gap.title}`,
    `Category: ${gap.category}`,
    `Related mode: ${gap.relatedMode}`,
    `Priority: ${gap.priority}`,
    `Similar questions: ${gap.similarQuestionCount}`,
  ];

  const sourceLines =
    sources.length === 0
      ? ["- No related sources were selected."]
      : sources.map((source) => `- ${formatSourceReference(source)}`);

  return [
    heading,
    "",
    "## Summary",
    gap.description ?? `Document the unresolved question: ${gap.title}.`,
    "",
    "## Context",
    ...summaryLines.map((line) => `- ${line}`),
    "",
    "## Acceptance Criteria",
    ...buildAcceptanceCriteria(gap, type).map((line) => `- ${line}`),
    "",
    "## Required Content",
    ...buildRequiredContent(gap, type).map((line) => `- ${line}`),
    "",
    "## Related Sources",
    ...sourceLines,
  ];
};

export const generateDraftCandidate = (
  input: DraftGenerationInput,
): DraftGenerationCandidate => {
  const persistedType = normalizeDraftType(input.type);
  const title =
    input.type === "github_issue"
      ? input.gap.suggestedGithubIssueTitle
      : input.gap.suggestedDocumentTitle;

  return {
    requestedType: input.type,
    persistedType,
    title,
    body: buildBodySections(input.gap, input.type, input.sources).join("\n"),
    acceptanceCriteria: buildAcceptanceCriteria(input.gap, input.type),
    requiredContent: buildRequiredContent(input.gap, input.type),
    relatedSources: input.sources.map(formatSourceReference),
  };
};

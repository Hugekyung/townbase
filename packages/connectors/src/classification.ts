export const CLASSIFIER_VERSION = "phase2-v1";

export type DocumentStatus = "active" | "draft" | "deprecated" | "archived";

export type KnowledgeType =
  | "onboarding"
  | "product_history"
  | "architecture"
  | "domain_policy"
  | "database"
  | "deployment"
  | "incident"
  | "code_convention"
  | "testing"
  | "operation"
  | "documentation_gap"
  | "unknown";

export type SourceType =
  | "notion_page"
  | "repo_readme"
  | "repo_docs"
  | "adr"
  | "prd"
  | "schema"
  | "migration"
  | "issue_template"
  | "pr_template"
  | "incident_review"
  | "github_issue"
  | "github_pr"
  | "slack_thread";

export type ClassificationResult = Readonly<{
  sourceType: SourceType;
  knowledgeTypes: ReadonlyArray<KnowledgeType>;
  domainTags: ReadonlyArray<string>;
  status: DocumentStatus;
  matchedRules: ReadonlyArray<string>;
  classifierVersion: string;
}>;

type ClassificationSeed = Readonly<{
  title: string;
  pathSegments: ReadonlyArray<string>;
  archived: boolean | undefined;
  sourceType: SourceType;
}>;

type RepoPathClassification = Readonly<{
  sourceType: SourceType;
  knowledgeTypes: ReadonlyArray<KnowledgeType>;
  domainTags: ReadonlyArray<string>;
  status: DocumentStatus;
  matchedRules: ReadonlyArray<string>;
}>;

const ONBOARDING_PHRASES = ["getting started", "onboarding", "onboard", "setup", "시작", "온보딩"];
const PRODUCT_HISTORY_PHRASES = ["prd", "기획", "요구사항", "decision", "결정"];
const ARCHITECTURE_PHRASES = ["adr", "architecture", "설계 결정"];
const INCIDENT_PHRASES = ["incident", "postmortem", "장애"];
const DEPLOYMENT_PHRASES = ["deploy", "deployment", "rollback", "cicd", "ci/cd", "배포"];
const DOMAIN_TAGS = ["payment", "order", "coupon", "settlement", "deployment", "auth", "onboarding"];

const normalize = (value: string): string => value.trim().toLowerCase();
const includesAny = (haystack: string, phrases: readonly string[]): boolean =>
  phrases.some((phrase) => haystack.includes(phrase));

const collectDomainTags = (title: string, pathSegments: ReadonlyArray<string>): string[] => {
  const normalizedText = [title, ...pathSegments].map(normalize).join(" ");
  const domainTags: string[] = [];

  if (includesAny(normalizedText, ["payment", "결제"])) domainTags.push("payment");
  if (includesAny(normalizedText, ["order", "주문"])) domainTags.push("order");
  if (includesAny(normalizedText, ["coupon", "쿠폰"])) domainTags.push("coupon");
  if (includesAny(normalizedText, ["settlement", "정산"])) domainTags.push("settlement");
  if (includesAny(normalizedText, DEPLOYMENT_PHRASES)) domainTags.push("deployment");
  if (includesAny(normalizedText, ["auth", "인증", "인가"])) domainTags.push("auth");
  if (includesAny(normalizedText, ONBOARDING_PHRASES)) domainTags.push("onboarding");

  return Array.from(new Set(domainTags.filter((tag) => DOMAIN_TAGS.includes(tag))));
};

const determineStatus = (
  text: string,
  archived?: boolean,
): DocumentStatus => {
  if (archived === true) return "archived";
  if (archived === undefined && includesAny(text, ["archive", "archived"])) return "archived";
  if (includesAny(text, ["deprecated", "deprecate"])) return "deprecated";
  return "active";
};

const classifyKnowledgeTypes = (text: string): ReadonlyArray<KnowledgeType> => {
  const knowledgeTypes: KnowledgeType[] = [];

  if (includesAny(text, ONBOARDING_PHRASES)) knowledgeTypes.push("onboarding");
  if (includesAny(text, PRODUCT_HISTORY_PHRASES)) knowledgeTypes.push("product_history");
  if (includesAny(text, ARCHITECTURE_PHRASES)) knowledgeTypes.push("architecture");
  if (includesAny(text, INCIDENT_PHRASES)) knowledgeTypes.push("incident");
  if (includesAny(text, DEPLOYMENT_PHRASES)) knowledgeTypes.push("deployment");

  return knowledgeTypes.length > 0 ? knowledgeTypes : ["unknown"];
};

const collectNotionRules = (
  title: string,
  pathSegments: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const normalizedTitle = normalize(title);
  const normalizedPath = pathSegments.map(normalize);
  const matchedRules: string[] = [];

  if (includesAny(normalizedTitle, ONBOARDING_PHRASES)) matchedRules.push("title:onboarding");
  if (includesAny(normalizedTitle, ["payment", "결제"])) matchedRules.push("title:payment");
  if (normalizedPath.some((segment) => includesAny(segment, ["onboarding"]))) matchedRules.push("path:onboarding");
  if (normalizedPath.some((segment) => includesAny(segment, ["payment", "결제"]))) matchedRules.push("path:payment");

  return matchedRules;
};

const collectRepoRules = (filePath: string): ReadonlyArray<string> => {
  const normalizedPath = normalize(filePath);
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  const matchedRules: string[] = [];

  if (basename === "readme.md") matchedRules.push("path:readme");
  if (normalizedPath.startsWith("docs/")) matchedRules.push("path:docs");
  if (normalizedPath.startsWith("adr/")) matchedRules.push("path:adr");
  if (normalizedPath.startsWith("architecture/")) matchedRules.push("path:architecture");
  if (normalizedPath.startsWith("prd/")) matchedRules.push("path:prd");
  if (normalizedPath === "prisma/schema.prisma" || basename === "schema.prisma") matchedRules.push("path:schema");
  if (normalizedPath.includes("/migrations/") || normalizedPath.startsWith("migrations/")) matchedRules.push("path:migration");
  if (normalizedPath.includes(".github/pull_request_template")) matchedRules.push("path:pr_template");
  if (normalizedPath.includes(".github/issue_template")) matchedRules.push("path:issue_template");
  if (normalizedPath.includes("incident") || normalizedPath.includes("postmortem")) matchedRules.push("path:incident_review");
  if (normalizedPath.includes("deprecated")) matchedRules.push("path:deprecated");
  if (normalizedPath.includes("archive")) matchedRules.push("path:archived");

  return matchedRules;
};

const classifyRepoPath = (filePath: string): RepoPathClassification => {
  const normalizedPath = normalize(filePath);
  const basename = normalizedPath.split("/").pop() ?? normalizedPath;
  const text = normalizedPath;
  const matchedRules = collectRepoRules(filePath);

  if (basename === "readme.md") {
    return {
      sourceType: "repo_readme",
      knowledgeTypes: ["onboarding"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath.startsWith("docs/")) {
    return {
      sourceType: "repo_docs",
      knowledgeTypes: classifyKnowledgeTypes(text),
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath.startsWith("adr/")) {
    return {
      sourceType: "adr",
      knowledgeTypes: ["architecture"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath.startsWith("prd/")) {
    return {
      sourceType: "prd",
      knowledgeTypes: ["product_history"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath === "prisma/schema.prisma" || basename === "schema.prisma") {
    return {
      sourceType: "schema",
      knowledgeTypes: ["database"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath.includes("/migrations/") || normalizedPath.startsWith("migrations/")) {
    return {
      sourceType: "migration",
      knowledgeTypes: ["database"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath.includes(".github/pull_request_template")) {
    return {
      sourceType: "pr_template",
      knowledgeTypes: ["code_convention"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath.includes(".github/issue_template")) {
    return {
      sourceType: "issue_template",
      knowledgeTypes: ["code_convention"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  if (normalizedPath.includes("incident") || normalizedPath.includes("postmortem")) {
    return {
      sourceType: "incident_review",
      knowledgeTypes: ["incident"],
      domainTags: collectDomainTags(basename, normalizedPath.split("/")),
      status: determineStatus(text),
      matchedRules,
    };
  }

  return {
    sourceType: "repo_docs",
    knowledgeTypes: classifyKnowledgeTypes(text),
    domainTags: collectDomainTags(basename, normalizedPath.split("/")),
    status: determineStatus(text),
    matchedRules,
  };
};

const buildClassificationResult = (seed: ClassificationSeed): ClassificationResult => {
  const normalizedText = [seed.title, ...seed.pathSegments].map(normalize).join(" ");
  return {
    sourceType: seed.sourceType,
    knowledgeTypes: classifyKnowledgeTypes(normalizedText),
    domainTags: collectDomainTags(seed.title, seed.pathSegments),
    status: determineStatus(normalizedText, seed.archived),
    matchedRules: collectNotionRules(seed.title, seed.pathSegments),
    classifierVersion: CLASSIFIER_VERSION,
  };
};

export const classifyNotionPage = (input: {
  title: string;
  pathSegments: ReadonlyArray<string>;
  archived: boolean | undefined;
}): ClassificationResult =>
  buildClassificationResult({
    title: input.title,
    pathSegments: input.pathSegments,
    archived: input.archived,
    sourceType: "notion_page",
  });

export const classifyRepositoryPath = (input: { filePath: string }): ClassificationResult =>
  ({
    ...classifyRepoPath(input.filePath),
    classifierVersion: CLASSIFIER_VERSION,
  });

export type NotionPageDraft = Readonly<{
  workspaceId: string;
  dataSourceId: string;
  externalId: string;
  sourceType: SourceType;
  title: string;
  url: string;
  content: string;
  status: DocumentStatus;
  knowledgeTypes: ReadonlyArray<KnowledgeType>;
  domainTags: ReadonlyArray<string>;
  externalCreatedAt: Date | null;
  externalUpdatedAt: Date;
  metadata: Readonly<{
    classifierVersion: string;
    matchedRules: ReadonlyArray<string>;
    pathSegments: ReadonlyArray<string>;
  }>;
}>;

export const mapNotionPageToDocumentDraft = (
  input: Readonly<{
    workspaceId: string;
    dataSourceId: string;
    page: Readonly<{
      id: string;
      title: string;
      url: string;
      createdTime?: string;
      lastEditedTime: string;
    }>;
    content: string;
    pathSegments: ReadonlyArray<string>;
    archived: boolean | undefined;
  }>,
): NotionPageDraft => {
  const classification = classifyNotionPage({
    title: input.page.title,
    pathSegments: input.pathSegments,
    archived: input.archived,
  });

  return {
    workspaceId: input.workspaceId,
    dataSourceId: input.dataSourceId,
    externalId: input.page.id,
    sourceType: classification.sourceType,
    title: input.page.title,
    url: input.page.url,
    content: input.content,
    status: classification.status,
    knowledgeTypes: classification.knowledgeTypes,
    domainTags: classification.domainTags,
    externalCreatedAt: input.page.createdTime === undefined ? null : new Date(input.page.createdTime),
    externalUpdatedAt: new Date(input.page.lastEditedTime),
    metadata: {
      classifierVersion: CLASSIFIER_VERSION,
      matchedRules: classification.matchedRules,
      pathSegments: input.pathSegments,
    },
  };
};

export const buildChunkMetadata = (input: Readonly<{
  sourceType: SourceType;
  knowledgeTypes: ReadonlyArray<KnowledgeType>;
  domainTags: ReadonlyArray<string>;
  status: DocumentStatus;
  matchedRules: ReadonlyArray<string>;
  chunkType: string;
  sourcePriority: number;
}>): Readonly<{
  sourceType: SourceType;
  knowledgeTypes: ReadonlyArray<KnowledgeType>;
  domainTags: ReadonlyArray<string>;
  status: DocumentStatus;
  classifierVersion: string;
  matchedRules: ReadonlyArray<string>;
  chunkType: string;
  sourcePriority: number;
}> => ({
  ...input,
  classifierVersion: CLASSIFIER_VERSION,
});

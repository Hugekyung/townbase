import type { NotionPageSnapshot } from "./types";

const CLASSIFIER_VERSION = "phase3-v1";

const ONBOARDING_PHRASES = [
  "getting started",
  "onboarding",
  "onboard",
  "setup",
  "시작",
  "온보딩",
] as const;

const PRODUCT_HISTORY_PHRASES = [
  "prd",
  "기획",
  "요구사항",
  "decision",
  "결정",
] as const;

const ARCHITECTURE_PHRASES = ["adr", "architecture", "설계 결정"] as const;

const INCIDENT_PHRASES = ["incident", "postmortem", "장애"] as const;

const DEPLOYMENT_PHRASES = [
  "deploy",
  "deployment",
  "rollback",
  "cicd",
  "ci/cd",
  "배포",
] as const;

const DOMAIN_TAGS = [
  "payment",
  "order",
  "coupon",
  "settlement",
  "deployment",
  "auth",
  "onboarding",
] as const;

const normalize = (value: string): string => value.trim().toLowerCase();

const includesAny = (haystack: string, phrases: readonly string[]): boolean =>
  phrases.some((phrase) => haystack.includes(phrase));

const collectMatchedRules = (
  title: string,
  pathSegments: ReadonlyArray<string>,
): string[] => {
  const normalizedTitle = normalize(title);
  const normalizedPathSegments = pathSegments.map((segment) => normalize(segment));
  const matchedRules: string[] = [];

  if (includesAny(normalizedTitle, ONBOARDING_PHRASES)) {
    matchedRules.push("title:onboarding");
  }

  if (includesAny(normalizedTitle, ["payment", "결제"])) {
    matchedRules.push("title:payment");
  }

  if (normalizedPathSegments.some((segment) => includesAny(segment, ["onboarding"]))) {
    matchedRules.push("path:onboarding");
  }

  if (normalizedPathSegments.some((segment) => includesAny(segment, ["payment", "결제"]))) {
    matchedRules.push("path:payment");
  }

  return matchedRules;
};

const collectKnowledgeTypes = (
  title: string,
  pathSegments: ReadonlyArray<string>,
): ReadonlyArray<
  "onboarding" | "product_history" | "architecture" | "incident" | "deployment" | "unknown"
> => {
  const normalizedText = [title, ...pathSegments].map((segment) => normalize(segment)).join(" ");
  const knowledgeTypes: Array<
    "onboarding" | "product_history" | "architecture" | "incident" | "deployment"
  > = [];

  if (includesAny(normalizedText, ONBOARDING_PHRASES)) {
    knowledgeTypes.push("onboarding");
  }

  if (includesAny(normalizedText, PRODUCT_HISTORY_PHRASES)) {
    knowledgeTypes.push("product_history");
  }

  if (includesAny(normalizedText, ARCHITECTURE_PHRASES)) {
    knowledgeTypes.push("architecture");
  }

  if (includesAny(normalizedText, INCIDENT_PHRASES)) {
    knowledgeTypes.push("incident");
  }

  if (includesAny(normalizedText, DEPLOYMENT_PHRASES)) {
    knowledgeTypes.push("deployment");
  }

  return knowledgeTypes.length > 0 ? knowledgeTypes : ["unknown"];
};

const collectDomainTags = (
  title: string,
  pathSegments: ReadonlyArray<string>,
): ReadonlyArray<(typeof DOMAIN_TAGS)[number]> => {
  const normalizedText = [title, ...pathSegments].map((segment) => normalize(segment)).join(" ");
  const domainTags: Array<(typeof DOMAIN_TAGS)[number]> = [];

  if (includesAny(normalizedText, ["payment", "결제"])) {
    domainTags.push("payment");
  }

  if (includesAny(normalizedText, ["order", "주문"])) {
    domainTags.push("order");
  }

  if (includesAny(normalizedText, ["coupon", "쿠폰"])) {
    domainTags.push("coupon");
  }

  if (includesAny(normalizedText, ["settlement", "정산"])) {
    domainTags.push("settlement");
  }

  if (includesAny(normalizedText, DEPLOYMENT_PHRASES)) {
    domainTags.push("deployment");
  }

  if (includesAny(normalizedText, ["auth", "인증", "인가"])) {
    domainTags.push("auth");
  }

  if (includesAny(normalizedText, ONBOARDING_PHRASES)) {
    domainTags.push("onboarding");
  }

  return Array.from(new Set(domainTags));
};

export type NotionPageClassification = Readonly<{
  sourceType: "notion_page";
  knowledgeTypes: ReadonlyArray<
    "onboarding" | "product_history" | "architecture" | "incident" | "deployment" | "unknown"
  >;
  domainTags: ReadonlyArray<(typeof DOMAIN_TAGS)[number]>;
  matchedRules: ReadonlyArray<string>;
}>;

export type NotionPageDraft = Readonly<{
  workspaceId: string;
  dataSourceId: string;
  externalId: string;
  sourceType: "notion_page";
  title: string;
  url: string;
  content: string;
  status: "active" | "archived";
  knowledgeTypes: ReadonlyArray<
    "onboarding" | "product_history" | "architecture" | "incident" | "deployment" | "unknown"
  >;
  domainTags: ReadonlyArray<(typeof DOMAIN_TAGS)[number]>;
  externalCreatedAt: Date | null;
  externalUpdatedAt: Date;
  metadata: Readonly<{
    classifierVersion: string;
    matchedRules: ReadonlyArray<string>;
    pathSegments: ReadonlyArray<string>;
  }>;
}>;

export const classifyNotionPage = (input: {
  title: string;
  pathSegments: ReadonlyArray<string>;
}): NotionPageClassification => {
  const matchedRules = collectMatchedRules(input.title, input.pathSegments);

  return {
    sourceType: "notion_page",
    knowledgeTypes: collectKnowledgeTypes(input.title, input.pathSegments),
    domainTags: collectDomainTags(input.title, input.pathSegments),
    matchedRules,
  };
};

export const mapNotionPageToDocumentDraft = (
  input: Readonly<{
    workspaceId: string;
    dataSourceId: string;
    page: NotionPageSnapshot["page"];
    content: string;
    pathSegments: ReadonlyArray<string>;
  }>,
): NotionPageDraft => {
  const classification = classifyNotionPage({
    title: input.page.title,
    pathSegments: input.pathSegments,
  });

  return {
    workspaceId: input.workspaceId,
    dataSourceId: input.dataSourceId,
    externalId: input.page.id,
    sourceType: classification.sourceType,
    title: input.page.title,
    url: input.page.url,
    content: input.content,
    status: "active",
    knowledgeTypes: classification.knowledgeTypes,
    domainTags: classification.domainTags,
    externalCreatedAt:
      input.page.createdTime === undefined
        ? null
        : new Date(input.page.createdTime),
    externalUpdatedAt: new Date(input.page.lastEditedTime),
    metadata: {
      classifierVersion: CLASSIFIER_VERSION,
      matchedRules: classification.matchedRules,
      pathSegments: input.pathSegments,
    },
  };
};

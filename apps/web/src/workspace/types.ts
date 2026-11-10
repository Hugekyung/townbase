export type Source = {
  promptLabel?: string;
  id: string;
  kind?: "rag" | "attachment";
  title: string;
  fileName?: string;
  reference?: string;
  locations?: {
    location: {
      page?: number;
      paragraph?: number;
      lineStart?: number;
      lineEnd?: number;
    };
    headingPath?: string[];
  }[];
};
export type AnswerOptions = { answerModel: string; reasoning: string };
export type Result = {
  modelOptions?: AnswerOptions | null;
  requestId: string;
  conversationId?: string;
  createdAt?: string;
  historyRequestIds?: string[];
  status: string;
  question: string | null;
  answer: string | null;
  model: string | null;
  errorCode: string | null;
  sourceState?: string;
  sources: Source[];
  calls?: {
    model: string;
    status: string;
    chargedUsd?: string | null;
    heldUsd?: string;
    chargedNanoUsd?: string | null;
    reservedNanoUsd?: string;
    usage: unknown;
  }[];
  result?: {
    // R05 RAG v2 rows set contractVersion 2; v1 rows and attachments omit it.
    contractVersion?: 2;
    followUps?: string[];
    claims: { text: string; evidence: { sourceId: string; quote: string }[] }[];
    conflicts: {
      text: string;
      evidence: { sourceId: string; quote: string }[];
    }[];
  } | null;
};
export type FileItem = {
  id: string;
  title: string;
  excludedAt: string | null;
  scopeRevision: number;
  version: {
    id: string;
    fileName: string;
    version: number;
    format: string;
    searchable: boolean;
    indexStatus: string;
    chunkCount: number;
    runs: { status: string; errorCode?: string | null }[];
  } | null;
};
export type Agent = {
  id: string;
  revision: number;
  name: string;
  purpose: string;
  instructions: string;
  terminology: { term: string; meaning: string }[];
  sourceSelection: "all" | "selected";
  sourceOriginalIds: string[];
};
export type Execution = {
  answerModel: string;
  reasoning: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  monthlyBudgetUsd: string | null;
  priceVersion: string | null;
};
export type Integration = {
  provider: string;
  credentials: Record<
    "answer" | "embedding",
    {
      configured: boolean;
      enabled: boolean;
      masked: string | null;
      connection: string;
    }
  >;
  transfers: { documentEmbedding: boolean; rag: boolean; attachment: boolean };
  execution: {
    settings: Execution;
    priceVersion: string;
    supportedReasoning: Record<string, string[]>;
    chargedUsd: string;
    heldUsd: string;
    warning80: boolean;
    blocked: boolean;
    pricing: { model: string; usdPerMillionTokens: Record<string, string> }[];
  };
  supportedAnswerModels: string[];
  embedding: { model: string; dimensions: number };
};

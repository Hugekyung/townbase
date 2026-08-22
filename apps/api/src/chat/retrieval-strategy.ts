export const RETRIEVAL_EXECUTION_STRATEGIES = ["vector_only", "mode_aware"] as const;

export type RetrievalExecutionStrategy = (typeof RETRIEVAL_EXECUTION_STRATEGIES)[number];

export const resolveRetrievalExecutionStrategy = (
  value: string | undefined = process.env.RAG_RETRIEVAL_STRATEGY,
): RetrievalExecutionStrategy => {
  if (value === undefined || value === "") {
    return "vector_only";
  }

  if ((RETRIEVAL_EXECUTION_STRATEGIES as readonly string[]).includes(value)) {
    return value as RetrievalExecutionStrategy;
  }

  throw new Error(
    `RAG_RETRIEVAL_STRATEGY must be one of: ${RETRIEVAL_EXECUTION_STRATEGIES.join(", ")}`,
  );
};

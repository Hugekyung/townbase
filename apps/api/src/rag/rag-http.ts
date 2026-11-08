export function isRagQuestion(request: {
  method?: string | undefined;
  originalUrl?: string | undefined;
  url?: string | undefined;
}) {
  const path = (request.originalUrl ?? request.url ?? "")
    .split("?", 1)[0]
    ?.replace(/\/$/, "")
    .toLowerCase();
  return request.method === "POST" && path === "/rag/questions";
}

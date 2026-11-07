export function isRagQuestion(request: {
  method?: string;
  originalUrl?: string;
  url?: string;
}) {
  const path = (request.originalUrl ?? request.url ?? "")
    .split("?", 1)[0]
    ?.replace(/\/$/, "")
    .toLowerCase();
  return request.method === "POST" && path === "/rag/questions";
}

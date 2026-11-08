export type ChatLocation =
  | { kind: "rag"; id?: string }
  | { kind: "attachment"; id?: string };
export type PageLocation =
  | ChatLocation
  | { kind: "settings"; section: string }
  | { kind: "documents" };
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readLocation(): PageLocation {
  const parts = window.location.hash.slice(1).split("/").filter(Boolean);
  if (parts[0] === "settings")
    return {
      kind: "settings",
      section: ["models", "account", "runs", "gaps", "operations"].includes(
        parts[1] ?? "",
      )
        ? parts[1]!
        : "models",
    };
  if (parts[0] === "documents") return { kind: "documents" };
  if (parts[0] === "attachment")
    return {
      kind: "attachment",
      ...(uuid.test(parts[1] ?? "") ? { id: parts[1]!.toLowerCase() } : {}),
    };
  return {
    kind: "rag",
    ...(uuid.test(parts[1] ?? "") ? { id: parts[1]!.toLowerCase() } : {}),
  };
}
export const chatHash = (kind: "rag" | "attachment", id?: string) =>
  "#/" + (kind === "rag" ? "chat" : "attachment") + (id ? "/" + id : "");

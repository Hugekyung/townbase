const WHITESPACE_RE = /\s+/g;

export const normalizeWhitespace = (text: string): string => text.trim().replace(WHITESPACE_RE, " ");

export const tokenize = (text: string): readonly string[] => {
  const normalized = normalizeWhitespace(text);
  return normalized.length === 0 ? [] : normalized.split(" ");
};

export const countTokens = (text: string): number => tokenize(text).length;

export const joinTokens = (tokens: readonly string[]): string => tokens.join(" ");

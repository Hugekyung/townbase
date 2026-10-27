export type MarkdownSection = Readonly<{
  headingPath: readonly string[];
  sectionTitle: string | null;
  content: string;
}>;

const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

export type LocatedMarkdownSection = MarkdownSection &
  Readonly<{ lineStart: number; lineEnd: number }>;

export const parseMarkdownSectionsWithLocations = (
  content: string,
): readonly LocatedMarkdownSection[] => {
  const lines = content.split(/\r?\n/);
  const sections: LocatedMarkdownSection[] = [];
  let bodyStartLine = 1;
  let bodyLines: string[] = [];
  let headingPath: string[] = [];
  let sawHeading = false;
  let inFence = false;

  const flushSection = (path: readonly string[]): void => {
    const raw = bodyLines.join("\n");
    if (raw.trim().length === 0) {
      bodyLines = [];
      return;
    }

    sections.push({
      lineStart: bodyStartLine,
      lineEnd: bodyStartLine + bodyLines.length - 1,
      headingPath: [...path],
      sectionTitle: path.length === 0 ? null : (path[path.length - 1] ?? null),
      content: raw,
    });
    bodyLines = [];
  };

  for (const [lineIndex, line] of lines.entries()) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      bodyLines.push(line);
      continue;
    }

    const headingMatch = inFence ? null : HEADING_RE.exec(line);
    if (headingMatch !== null) {
      flushSection(headingPath);
      bodyStartLine = lineIndex + 2;
      const headingLevelToken = headingMatch[1];
      const headingTitleToken = headingMatch[2];
      if (headingLevelToken === undefined || headingTitleToken === undefined) {
        bodyLines.push(line);
        continue;
      }

      const headingLevel = headingLevelToken.length;
      const headingTitle = headingTitleToken.trim();
      headingPath = headingPath.slice(0, headingLevel - 1);
      headingPath.push(headingTitle);
      sawHeading = true;
      continue;
    }

    bodyLines.push(line);
  }

  flushSection(headingPath);
  return sawHeading ? sections : [];
};

// Preserve the existing public result shape for legacy chunking consumers.
export const parseMarkdownSections = (
  content: string,
): readonly MarkdownSection[] =>
  parseMarkdownSectionsWithLocations(content).map(
    ({ headingPath, sectionTitle, content: body }) => ({
      headingPath,
      sectionTitle,
      content: body,
    }),
  );

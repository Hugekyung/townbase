export type MarkdownSection = Readonly<{
  headingPath: readonly string[];
  sectionTitle: string | null;
  content: string;
}>;

const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

export const parseMarkdownSections = (content: string): readonly MarkdownSection[] => {
  const lines = content.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
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
      headingPath: [...path],
      sectionTitle: path.length === 0 ? null : path[path.length - 1] ?? null,
      content: raw,
    });
    bodyLines = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      bodyLines.push(line);
      continue;
    }

    const headingMatch = inFence ? null : HEADING_RE.exec(line);
    if (headingMatch !== null) {
      flushSection(headingPath);
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

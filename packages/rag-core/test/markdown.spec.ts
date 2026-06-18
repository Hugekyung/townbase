import { parseMarkdownSections } from "../src/markdown";

describe("parseMarkdownSections", () => {
  it("preserves section formatting instead of normalizing it away", () => {
    const sections = parseMarkdownSections(
      [
        "   # Intro",
        "paragraph one",
        "",
        "    code block line",
        "## Details",
        "line 1",
        "line 2",
      ].join("\n"),
    );

    expect(sections).toEqual([
      {
        headingPath: ["Intro"],
        sectionTitle: "Intro",
        content: "paragraph one\n\n    code block line",
      },
      {
        headingPath: ["Intro", "Details"],
        sectionTitle: "Details",
        content: "line 1\nline 2",
      },
    ]);
  });

  it("recognizes indented ATX headings and tilde fences without treating fenced text as headings", () => {
    const sections = parseMarkdownSections(
      [
        "~~~ts",
        "   # Shadow Heading",
        "const value = 1",
        "~~~",
        "  ## Visible Heading",
        "body text",
      ].join("\n"),
    );

    expect(sections).toEqual([
      {
        headingPath: [],
        sectionTitle: null,
        content: "~~~ts\n   # Shadow Heading\nconst value = 1\n~~~",
      },
      {
        headingPath: ["Visible Heading"],
        sectionTitle: "Visible Heading",
        content: "body text",
      },
    ]);
  });
});

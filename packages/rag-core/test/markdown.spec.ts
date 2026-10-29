import {
  parseMarkdownSections,
  parseMarkdownSectionsWithLocations,
} from "../src/markdown";

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

describe("Markdown matching fence boundaries and source positions", () => {
  it.each([
    ["```", "~~~", "```"],
    ["~~~~", "~~~", "~~~~~"],
    ["````", "```", "`````"],
    ["```ts", "```not-a-close", "```"],
    ["~~~ts", "~~~not-a-close", "~~~"],
  ])(
    "keeps inner headings inside %s until a valid close",
    (opening, inner, closing) => {
      const text = [
        "# Intro",
        opening,
        inner,
        "# Inside code",
        closing,
        "## Visible",
        "body",
      ].join("\n");
      const sections = parseMarkdownSectionsWithLocations(text);
      expect(sections).toHaveLength(2);
      expect(sections[0]).toMatchObject({
        headingPath: ["Intro"],
        lineStart: 2,
        lineEnd: 5,
      });
      expect(sections[0]?.content).toContain("# Inside code");
      expect(sections[1]).toMatchObject({
        headingPath: ["Intro", "Visible"],
        lineStart: 7,
        lineEnd: 7,
      });
    },
  );
  it("accepts a longer matching close with trailing spaces/tabs", () => {
    const sections = parseMarkdownSectionsWithLocations(
      "# Intro\n```\n# Code\n```` \t\n## Visible\nbody",
    );
    expect(sections[1]?.headingPath).toEqual(["Intro", "Visible"]);
  });
  it("unclosed fence keeps all later headings as code", () => {
    const sections = parseMarkdownSectionsWithLocations(
      "# Intro\n````\n```\n# Inside\n~~~\n## Still inside",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.headingPath).toEqual(["Intro"]);
    expect(sections[0]?.lineEnd).toBe(6);
  });
  it("a backtick in the opening info string does not start a fence", () => {
    const sections = parseMarkdownSectionsWithLocations(
      "# Intro\n```bad`info\n## Visible\nbody",
    );
    expect(sections[1]).toMatchObject({
      headingPath: ["Intro", "Visible"],
      lineStart: 4,
      lineEnd: 4,
    });
  });
});

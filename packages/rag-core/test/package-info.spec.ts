import { RAG_CORE_PACKAGE_INFO } from "../src/index";

describe("rag-core package scaffold", () => {
  it("exports the package identity seam", () => {
    expect(RAG_CORE_PACKAGE_INFO.name).toBe("@townbase/rag-core");
  });
});

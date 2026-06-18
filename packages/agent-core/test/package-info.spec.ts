import { AGENT_CORE_PACKAGE_INFO } from "../index";

describe("agent-core package scaffold", () => {
  it("exports the package identity seam", () => {
    expect(AGENT_CORE_PACKAGE_INFO.name).toBe("@townbase/agent-core");
  });
});

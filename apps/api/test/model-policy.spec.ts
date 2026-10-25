import {
  DEFAULT_EXECUTION,
  PRICE_VERSION,
  cost,
  digest,
  inputBound,
  parseBudget,
  reservation,
  usd,
  validExecution,
  validRequestId,
} from "../src/model-integration/model-policy";
describe("model configuration and exact cost arithmetic", () => {
  test.each(["gpt-6-luna", "gpt-6.1-sol"])(
    "supports approved %s and bounded reasoning",
    (answerModel) => {
      expect(validExecution({ ...DEFAULT_EXECUTION, answerModel })).toBe(true);
      expect(
        validExecution({
          ...DEFAULT_EXECUTION,
          answerModel,
          reasoning: "none",
        }),
      ).toBe(answerModel === "gpt-6-luna");
    },
  );
  test.each([
    {},
    null,
    undefined,
    { ...DEFAULT_EXECUTION, answerModel: "gpt-unknown" },
    { ...DEFAULT_EXECUTION, inputTokenLimit: 16001 },
    { ...DEFAULT_EXECUTION, outputTokenLimit: 4097 },
    { ...DEFAULT_EXECUTION, priceVersion: "stale" },
  ])("rejects unsupported configuration %#", (value) =>
    expect(validExecution(value)).toBe(false),
  );
  test.each([
    undefined,
    0,
    1,
    "0",
    "-1",
    "1e3",
    "01",
    "0.001",
    "100000",
    "NaN",
  ])("rejects invalid budget %p", (v) =>
    expect(() => parseBudget(v)).toThrow("invalid_budget"),
  );
  test("budget writes require explicit cents and price confirmation", () => {
    expect(parseBudget(null)).toBeNull();
    expect(parseBudget("20.01")).toBe(20010000000n);
    expect(usd(1n)).toBe("0.000000001");
    expect(DEFAULT_EXECUTION.priceVersion).toBeNull();
    expect(DEFAULT_EXECUTION.monthlyBudgetUsd).toBeNull();
    expect(
      validExecution({ ...DEFAULT_EXECUTION, priceVersion: PRICE_VERSION }),
    ).toBe(true);
  });
  test("separates cache reads and both write lifetimes without double counting reasoning", () => {
    const usage = {
      input: 12000,
      cached: 4000,
      write30: 3000,
      write12: 4000,
      output: 200,
      reasoning: 150,
    };
    expect(cost("gpt-6-luna", usage)).toBe(1615000n);
    expect(cost("gpt-6.1-sol", usage)).toBe(31900000n);
    expect(reservation("gpt-6-luna", 12000, 200)).toBeGreaterThanOrEqual(
      cost("gpt-6-luna", usage),
    );
    expect(
      cost("text-embedding-3-small", {
        input: 100,
        cached: 0,
        write30: 0,
        write12: 0,
        output: 0,
        reasoning: 0,
      }),
    ).toBe(2000n);
    expect(() => reservation("unknown", 1, 1)).toThrow("unsupported_model");
  });
  test("canonical request fingerprints ignore JSON property order but preserve content", () => {
    expect(digest({ a: 1, b: [2, 3] })).toBe(digest({ b: [2, 3], a: 1 }));
    expect(digest({ a: 1, b: [2, 3] })).not.toBe(digest({ a: 1, b: [3, 2] }));
    expect(inputBound("한글")).toBe(262);
    expect(validRequestId("1")).toBe(false);
    expect(validRequestId("12345678-1234-4234-8234-123456789012")).toBe(true);
  });
});

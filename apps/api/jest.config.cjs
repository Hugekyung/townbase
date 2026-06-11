module.exports = {
  rootDir: ".",
  moduleFileExtensions: ["js", "json", "ts"],
  testEnvironment: "node",
  testRegex: ".*\\.(spec|e2e-spec)\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "../coverage",
};

import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],

  testMatch: ["**/*.test.ts"],
  verbose: true,
};

export default config;

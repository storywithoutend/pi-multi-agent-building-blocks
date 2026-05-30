import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

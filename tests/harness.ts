/**
 * Shared RPC test harness for driving pi extensions under test.
 *
 * Wraps RpcClient with sensible defaults (haiku model, thinking off,
 * no context files) and provides helpers for session file retrieval.
 */

import * as path from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";

export interface TestAgent {
  client: RpcClient;
  start(): Promise<void>;
  stop(): Promise<void>;
  sessionFile(): Promise<string | undefined>;
}

export function createTestAgent(
  extensionPath: string,
  opts?: {
    model?: string;
    thinking?: string;
  },
): TestAgent {
  const projectRoot = path.resolve(import.meta.dirname, "..");
  const resolvedExt = path.resolve(projectRoot, extensionPath);

  // Resolve the pi CLI entry point from the installed package.
  const cliPath = path.join(
    projectRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js",
  );

  const model = opts?.model ?? "openrouter/anthropic/claude-3.5-haiku";
  const thinking = opts?.thinking ?? "off";

  const client = new RpcClient({
    cliPath,
    cwd: projectRoot,
    args: [
      "--no-context-files",
      "--thinking", thinking,
      "--model", model,
      "-e", resolvedExt,
    ],
  });

  return {
    client,
    async start() {
      await client.start();
    },
    async stop() {
      await client.stop();
    },
    async sessionFile() {
      const state = await client.getState();
      return state.sessionFile;
    },
  };
}

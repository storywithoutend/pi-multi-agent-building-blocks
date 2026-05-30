/**
 * Integration tests for the 01-critic extension.
 *
 * Drives pi via RpcClient, sends prompts and commands, then evaluates
 * the session trace against a rubric.
 */

import { describe, it, expect, afterEach } from "vitest";
import { createTestAgent, type TestAgent } from "./harness.ts";
import {
  evaluateRubric,
  hasCustomMessage,
  noErrors,
  minAssistantTurns,
  customMessageMatches,
} from "./rubric.ts";

const EXTENSION = "./01-critic/index.ts";

describe("01-critic", () => {
  let agent: TestAgent;

  afterEach(async () => {
    await agent?.stop();
  });

  it("single turn produces assistant response", async () => {
    agent = createTestAgent(EXTENSION);
    await agent.start();

    const events = await agent.client.promptAndWait(
      "Write a haiku about cherry blossoms in spring",
      undefined,
      60_000,
    );

    // Should have received at least one assistant message
    const assistantMessages = events.filter(
      (e: any) => e.type === "message_end" && e.message?.role === "assistant",
    );
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

    // Retrieve the text and verify it's non-empty
    const text = await agent.client.getLastAssistantText();
    expect(text).toBeTruthy();

    // Rubric: no errors in the session trace
    const sessionPath = await agent.sessionFile();
    if (sessionPath) {
      const result = evaluateRubric(sessionPath, [noErrors()]);
      expect(result.passed).toBe(true);
    }
  });

  it("critic loop runs and produces feedback", async () => {
    agent = createTestAgent(EXTENSION);
    await agent.start();

    // 1. Generate initial content
    await agent.client.promptAndWait(
      "Write a haiku about cherry blossoms in spring",
      undefined,
      60_000,
    );

    // 2. Trigger the critic loop via the /critic command
    await agent.client.promptAndWait(
      "/critic",
      undefined,
      90_000,
    );

    // 3. Wait for the critic loop to settle (it runs autonomously via agent_end)
    //    The loop sends follow-up messages internally, so we collect events
    //    until the agent is idle for a sustained period.
    let idleAttempts = 0;
    const maxWaits = 10;
    while (idleAttempts < maxWaits) {
      try {
        await agent.client.waitForIdle(15_000);
        // Check if the agent is truly done by looking for critic state
        const text = await agent.client.getLastAssistantText();
        if (text) break;
      } catch {
        // Timeout waiting for idle — the loop may still be running
      }
      idleAttempts++;
    }

    // 4. Evaluate the session trace against rubric
    const sessionPath = await agent.sessionFile();
    expect(sessionPath).toBeTruthy();

    const result = evaluateRubric(sessionPath!, [
      hasCustomMessage("critic-feedback"),
      minAssistantTurns(2),
      customMessageMatches("critic-feedback", /approved|revise|critique/i),
    ]);

    // Log check details for debugging
    for (const check of result.checks) {
      console.log(
        `  ${check.pass ? "\u2713" : "\u2717"} ${check.name}: ${check.detail}`,
      );
    }

    expect(result.passed).toBe(true);
  });
});

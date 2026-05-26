/**
 * Critic — iterative review loop
 *
 * On startup, pre-fills the input with a haiku prompt.
 * The /critic command sends the last assistant message to a sub-pi instance
 * for review. If the critic says "approved", it stops. Otherwise it feeds the
 * feedback back as a user message so the main LLM revises — up to 8 iterations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const CRITIC_DIR = path.join(__dirname, "critic-system");
const CRITIC_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const MAX_ITERATIONS = 8;
const MESSAGE_TYPE = "critic-feedback";

interface CriticState {
  round: number;
}

export default function criticExtension(pi: ExtensionAPI) {
  let criticState: CriticState | null = null;

  // Render critic-feedback messages in the transcript
  pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
    let text = theme.bold(theme.fg("accent", "┌─ CRITIC ──────────────────────────────\n"));
    text += message.content;
    text += theme.bold(theme.fg("accent", "\n└──────────────────────────────────────"));
    return new Text(text, 0, 0);
  });

  // Pre-fill the editor and reset state on session start
  pi.on("session_start", async (_event, ctx) => {
    criticState = null;
    ctx.ui.setEditorText("Write a haiku about cherry blossoms in spring.");
  });

  // After each LLM response, run the next critic round if we're in a loop
  pi.on("agent_end", async (_event, ctx) => {
    if (!criticState) return;

    const text = getLastAssistantText(ctx);
    if (!text) {
      ctx.ui.notify("No assistant response after revision.", "error");
      criticState = null;
      return;
    }

    const round = criticState.round;
    ctx.ui.setStatus("critic", `Critic is reviewing (round ${round}/${MAX_ITERATIONS})…`);

    const output = await spawnCritic(text);
    ctx.ui.setStatus("critic", undefined);

    const trimmed = output.trim();
    pi.sendMessage({ customType: MESSAGE_TYPE, content: trimmed, display: true });

    if (/\bapproved\b/i.test(trimmed)) {
      ctx.ui.notify(`✓ Approved after ${round} round${round === 1 ? "" : "s"}!`, "info");
      criticState = null;
      return;
    }

    if (round >= MAX_ITERATIONS) {
      ctx.ui.notify(`✗ Max iterations (${MAX_ITERATIONS}) reached without approval.`, "warning");
      criticState = null;
      return;
    }

    // Advance and send feedback via setTimeout to defer past agent_end.
    // The agent is still "processing" while agent_end listeners run, and there
    // is no post-agent_end event. setTimeout escapes the listener call stack.
    criticState.round++;
    const feedback = trimmed || "Please revise based on the critique above.";
    setTimeout(() => {
      pi.sendUserMessage(feedback);
    }, 0);
  });

  pi.registerCommand("critic", {
    description: "Run iterative critique on the last assistant message (max 8 rounds)",
    handler: async (_args, ctx) => {
      const assistantText = getLastAssistantText(ctx);
      if (assistantText === null) {
        ctx.ui.notify("No assistant message found to critique.", "error");
        return;
      }

      // Arm state and kick off the loop. The agent is idle here so no
      // deliverAs is needed — sendUserMessage triggers a new turn immediately.
      criticState = { round: 1 };
      pi.sendUserMessage(
        `Please review and revise this haiku:\n\n${assistantText}`,
      );
    },
  });

  // ── helpers ──────────────────────────────────────────────────────────

  function getLastAssistantText(ctx: any): string | null {
    const branch = ctx.sessionManager.getBranch();
    const entries = [...branch].reverse();

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      if (entry.message.role !== "assistant") continue;

      const text = entry.message.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n")
        .trim();

      if (text) return text;
    }

    return null;
  }

  async function spawnCritic(text: string): Promise<string> {
    const systemMdPath = path.join(CRITIC_DIR, "SYSTEM.md");
    const systemPrompt = fs.readFileSync(systemMdPath, "utf-8").trim();

    const prompt = `Please critique this haiku:\n\n${text}`;

    try {
      const result = await pi.exec("pi", [
        "-p", prompt,
        "--system-prompt", systemPrompt,
        "--model", CRITIC_MODEL,
        "--thinking", "off",
        "--no-extensions",
        "--no-context-files",
        "--no-session",
      ], {
        cwd: CRITIC_DIR,
        timeout: 120_000,
      });
      return result.stdout ?? "";
    } catch (err: any) {
      return `CRITIC ERROR: ${err?.message ?? String(err)}`;
    }
  }
}

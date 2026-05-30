/**
 * Critic — iterative review loop
 *
 * On startup, pre-fills the input with a haiku prompt.
 * The /critic command sends the last assistant message to a sub-pi instance
 * for review. If the critic says "approved", it stops. Otherwise it feeds the
 * feedback back as a user message so the main LLM revises — up to 8 iterations.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { type ExtensionAPI, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const CRITIC_DIR = path.join(__dirname, "critic-system");
const MAX_ITERATIONS = 8;
const MESSAGE_TYPE = "critic-feedback";
const SPINNER = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];

interface CriticState {
  round: number;
}

interface CriticStreamState {
  liveText: string;
  toolUseCount: number;
  currentTool: string | null;
  startTime: number;
  spinnerIndex: number;
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

    const output = await spawnCritic(text, ctx);
    ctx.ui.setStatus("critic", undefined);

    const trimmed = output.text.trim();
    const sessionMarker = output.sessionId ? `\n[subprocess-session:${output.sessionId}]` : "";
    pi.sendMessage({ customType: MESSAGE_TYPE, content: trimmed + sessionMarker, display: true });

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
      pi.sendUserMessage(feedback, { deliverAs: "followUp"});
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

  function renderCriticWidget(state: CriticStreamState, round: number): string[] {
    const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
    const frame = SPINNER[state.spinnerIndex % SPINNER.length];
    const stats = [
      `${state.toolUseCount} tool use${state.toolUseCount !== 1 ? "s" : ""}`,
      `${elapsed}s`,
    ].join(" \u00B7 ");

    const lines: string[] = [`${frame} Critic round ${round}/${MAX_ITERATIONS} \u00B7 ${stats}`];

    if (state.currentTool) {
      lines.push(`   \u23BF  ${state.currentTool}\u2026`);
    }

    if (state.liveText) {
      const textLines = state.liveText.split("\n");
      const tail = textLines.slice(-6);
      lines.push("");
      lines.push(...tail);
    }

    return lines;
  }

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

  // Lazily-parsed agent config from SYSTEM.md frontmatter
  let criticAgentConfig: {
    model: string;
    thinking: string;
    systemPrompt: string;
  } | null = null;

  function getCriticAgentConfig() {
    if (criticAgentConfig) return criticAgentConfig;

    const systemMdPath = path.join(CRITIC_DIR, "SYSTEM.md");
    const raw = fs.readFileSync(systemMdPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(raw);

    criticAgentConfig = {
      model: frontmatter.model ?? "openrouter/anthropic/claude-3.5-haiku",
      thinking: frontmatter.thinking ?? "off",
      systemPrompt: body.trim(),
    };
    return criticAgentConfig;
  }

  async function spawnCritic(text: string, ctx: any): Promise<{ text: string; sessionId: string | null }> {
    const config = getCriticAgentConfig();
    const round = criticState?.round ?? 1;

    const args = [
      "--mode", "json",
      "-p",
      "--system-prompt", config.systemPrompt,
      "--model", config.model,
      "--thinking", config.thinking,
      "--no-extensions",
      "--no-context-files",
      `Please critique this haiku:\n\n${text}`,
    ];

    const messages: Message[] = [];
    let stderr = "";
    let subSessionId: string | null = null;
    const stream: CriticStreamState = {
      liveText: "",
      toolUseCount: 0,
      currentTool: null,
      startTime: Date.now(),
      spinnerIndex: 0,
    };

    return new Promise<{ text: string; sessionId: string | null }>((resolve) => {
      const proc = spawn("pi", args, {
        cwd: CRITIC_DIR,
        env: { ...process.env, PI_CODING_AGENT_DIR: CRITIC_DIR },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let buffer = "";

      const emitWidget = () => {
        ctx.ui.setWidget("critic-live", renderCriticWidget(stream, round), {
          placement: "aboveEditor",
        });
      };

      // Animate the spinner while the subprocess is running
      const spinnerInterval = setInterval(() => {
        stream.spinnerIndex++;
        emitWidget();
      }, 100);

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: any;
        try { event = JSON.parse(line); } catch { return; }

        if (event.type === "session" && event.id && !subSessionId) {
          subSessionId = event.id;
        }

        if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta" && typeof delta.delta === "string") {
            stream.liveText += delta.delta;
            emitWidget();
          } else if (delta?.type === "text_start") {
            stream.liveText = "";
            stream.currentTool = null;
            emitWidget();
          } else if (delta?.type === "tool_use_start") {
            stream.toolUseCount++;
            stream.currentTool = delta.name ?? "tool";
            emitWidget();
          }
        }

        if (event.type === "tool_result_end") {
          stream.currentTool = null;
          emitWidget();
          if (event.message) messages.push(event.message as Message);
        }

        if (event.type === "message_end" && event.message) {
          messages.push(event.message as Message);
        }
      };

      proc.stdout.on("data", (data: string) => {
        buffer += data;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      });

      proc.stderr.on("data", (data: string) => {
        stderr += data;
      });

      const cleanup = () => {
        clearInterval(spinnerInterval);
        ctx.ui.setWidget("critic-live", undefined);
      };

      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        cleanup();
        resolve({ text: "CRITIC ERROR: Timed out after 120s", sessionId: subSessionId });
      }, 120_000);

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (buffer.trim()) processLine(buffer);
        cleanup();

        // Extract final assistant text from accumulated messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === "assistant") {
            for (const part of msg.content) {
              if (part.type === "text" && part.text.trim()) {
                resolve({ text: part.text.trim(), sessionId: subSessionId });
                return;
              }
            }
          }
        }
        resolve({ text: stderr || `CRITIC ERROR: No output (exit code ${code})`, sessionId: subSessionId });
      });

      proc.on("error", (err: Error) => {
        clearTimeout(timeout);
        cleanup();
        resolve({ text: `CRITIC ERROR: ${err.message}`, sessionId: subSessionId });
      });

      // Propagate abort signal from the main agent
      const signal = ctx.signal;
      if (signal) {
        const killProc = () => {
          proc.kill("SIGTERM");
          setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
        };
        if (signal.aborted) killProc();
        else signal.addEventListener("abort", killProc, { once: true });
      }
    });
  }
}

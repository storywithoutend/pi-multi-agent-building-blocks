#!/usr/bin/env npx tsx
/**
 * General-purpose pi session trace viewer.
 *
 * Usage:
 *   npx tsx tools/trace-viewer.ts                  # latest session for cwd project
 *   npx tsx tools/trace-viewer.ts <path>           # specific .jsonl file
 *   npx tsx tools/trace-viewer.ts --full           # no content truncation
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  parseSessionFile,
  findLatestSession,
  findSessionById,
  type SessionEvent,
} from "./trace-parser.ts";

// ── ANSI helpers (zero dependencies) ─────────────────────────────────

const esc = (code: string) => `\x1b[${code}m`;
const reset = esc("0");
const bold = (s: string) => `${esc("1")}${s}${reset}`;
const dim = (s: string) => `${esc("2")}${s}${reset}`;
const green = (s: string) => `${esc("32")}${s}${reset}`;
const blue = (s: string) => `${esc("34")}${s}${reset}`;
const yellow = (s: string) => `${esc("33")}${s}${reset}`;
const red = (s: string) => `${esc("31")}${s}${reset}`;
const cyan = (s: string) => `${esc("36")}${s}${reset}`;

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const fullMode = args.includes("--full");
const positional = args.filter((a) => !a.startsWith("--"));

// ── Resolve session file ─────────────────────────────────────────────

let sessionFile: string;
if (positional.length > 0) {
  sessionFile = path.resolve(positional[0]);
} else {
  const found = findLatestSession(process.cwd());
  if (!found) {
    console.error(red("No session files found for current directory."));
    console.error(dim(`  Looked in: ~/.pi/agent/sessions/`));
    process.exit(1);
  }
  sessionFile = found;
}

if (!fs.existsSync(sessionFile)) {
  console.error(red(`File not found: ${sessionFile}`));
  process.exit(1);
}

// ── Rendering helpers ────────────────────────────────────────────────

const MAX_LINES = 4;

function truncate(text: string): string {
  if (fullMode) return text;
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES) return text;
  return lines.slice(0, MAX_LINES).join("\n") + dim(`\n  … (${lines.length - MAX_LINES} more lines)`);
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(6)}`;
  return `$${cost.toFixed(4)}`;
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((l) => prefix + l).join("\n");
}

// ── Main rendering ───────────────────────────────────────────────────

function renderSession(events: SessionEvent[], indentLevel = 0): void {
  const pad = "  ".repeat(indentLevel);
  const out = (s: string) => console.log(indent(s, pad));

  // Stats
  let errorCount = 0;
  let assistantTurns = 0;
  let totalCost = 0;

  // Session header
  const sessionEvt = events.find((e) => e.type === "session");
  const modelEvt = events.find((e) => e.type === "model_change");
  const thinkingEvt = events.find((e) => e.type === "thinking_level_change");

  out(bold("═".repeat(60)));
  if (sessionEvt) {
    out(bold("Session: ") + cyan(sessionEvt.id ?? "unknown"));
    if (sessionEvt.timestamp) out(bold("Time:    ") + formatTimestamp(sessionEvt.timestamp));
    if (sessionEvt.cwd) out(bold("CWD:     ") + sessionEvt.cwd);
  }
  if (modelEvt) {
    const provider = modelEvt.provider ? `${modelEvt.provider}/` : "";
    out(bold("Model:   ") + `${provider}${modelEvt.modelId}`);
  }
  if (thinkingEvt) {
    out(bold("Think:   ") + thinkingEvt.thinkingLevel);
  }
  out(bold("═".repeat(60)));
  out("");

  // Track message numbering and pending tool calls
  let msgNum = 0;
  const pendingToolCalls: Map<string, { name: string; args: any }> = new Map();

  for (const event of events) {
    if (event.type === "session" || event.type === "model_change" || event.type === "thinking_level_change") {
      continue; // already rendered in header
    }

    if (event.type === "message") {
      const msg = event.message;
      if (!msg) continue;

      if (msg.role === "user") {
        msgNum++;
        out(bold(green(`── [${msgNum}] USER `) + green("─".repeat(Math.max(0, 45 - String(msgNum).length)))));
        const textParts = (msg.content ?? []).filter((c: any) => c.type === "text");
        for (const part of textParts) {
          out(green(truncate(part.text)));
        }
        out("");
      } else if (msg.role === "assistant") {
        msgNum++;
        const isError = msg.stopReason === "error";
        if (isError) errorCount++;
        assistantTurns++;

        const cost = msg.usage?.cost?.total ?? 0;
        totalCost += cost;

        const label = isError ? red(`── [${msgNum}] ASSISTANT (ERROR)`) : blue(`── [${msgNum}] ASSISTANT`);
        const separator = isError ? red("─".repeat(40)) : blue("─".repeat(40));
        out(bold(label + " " + separator.slice(0, 40)));

        // Metadata line
        const meta: string[] = [];
        if (msg.model) meta.push(msg.model);
        if (msg.stopReason) meta.push(`stop=${msg.stopReason}`);
        if (msg.usage) {
          const u = msg.usage;
          meta.push(`in=${u.input ?? 0} out=${u.output ?? 0}`);
          if (u.cacheRead) meta.push(`cache=${u.cacheRead}`);
        }
        if (cost > 0) meta.push(formatCost(cost));
        if (meta.length > 0) out(dim(`  ${meta.join(" · ")}`));

        if (isError && msg.errorMessage) {
          out(red(`  ERROR: ${msg.errorMessage}`));
          out("");
          continue;
        }

        // Content blocks
        const content = msg.content ?? [];
        const toolCalls: any[] = [];
        let hasText = false;

        for (const block of content) {
          if (block.type === "thinking") {
            out(dim("  [thinking]"));
          } else if (block.type === "text" && block.text?.trim()) {
            hasText = true;
            out(blue(truncate(block.text)));
          } else if (block.type === "toolCall") {
            toolCalls.push(block);
            pendingToolCalls.set(block.id, { name: block.name, args: block.arguments });
          }
        }

        // Render tool calls as a tree
        if (toolCalls.length > 0) {
          if (hasText) out(""); // spacer after text
          for (let i = 0; i < toolCalls.length; i++) {
            const tc = toolCalls[i];
            const isLast = i === toolCalls.length - 1;
            const prefix = isLast ? "└─" : "├─";
            const argSummary = summarizeToolArgs(tc.name, tc.arguments);
            out(dim(`  ${prefix} tool: ${tc.name}`) + (argSummary ? dim(` ${argSummary}`) : ""));
          }
        }
        out("");
      } else if (msg.role === "toolResult") {
        // Tool results — attach to the pending tool call
        const callId = msg.toolCallId;
        const toolInfo = pendingToolCalls.get(callId);
        const toolName = msg.toolName ?? toolInfo?.name ?? "unknown";
        pendingToolCalls.delete(callId);

        const textParts = (msg.content ?? []).filter((c: any) => c.type === "text");
        const resultText = textParts.map((c: any) => c.text).join("\n").trim();

        out(dim(`  └─ result (${toolName}):`));
        if (resultText) {
          out(dim(indent(truncate(resultText), "     ")));
        }
        out("");
      }
    } else if (event.type === "custom_message") {
      const customType = event.customType ?? "CUSTOM";
      const label = customType === "critic-feedback" ? "CRITIC" : customType.toUpperCase();
      const content = event.content ?? "";

      out(yellow(bold(`┌─ ${label} ${"─".repeat(Math.max(0, 55 - label.length))}`)));
      // Strip subprocess-session markers from display content
      const displayContent = content.replace(/\n?\[subprocess-session:[^\]]+\]/g, "");
      out(yellow(truncate(displayContent)));
      out(yellow(bold(`└${"─".repeat(58)}`)));

      // Check for subprocess session marker
      const subMatch = content.match(/\[subprocess-session:([^\]]+)\]/);
      if (subMatch) {
        const subId = subMatch[1];
        const subFile = findSessionById(subId);
        if (subFile) {
          out("");
          out(dim(`  ▶ Subprocess session: ${subId}`));
          const subEvents = parseSessionFile(subFile);
          renderSession(subEvents, indentLevel + 2);
          out(dim(`  ◀ End subprocess session`));
        } else {
          out(dim(`  ⚠ Subprocess session ${subId} not found`));
        }
      }
      out("");
    }
  }

  // Summary footer
  out(bold("═".repeat(60)));
  out(bold("Summary"));
  out(`  Events:          ${events.length}`);
  out(`  Assistant turns:  ${assistantTurns}`);
  if (errorCount > 0) out(red(`  Errors:           ${errorCount}`));
  if (totalCost > 0) out(`  Total cost:       ${formatCost(totalCost)}`);
  out(bold("═".repeat(60)));
}

function summarizeToolArgs(name: string, args: any): string {
  if (!args) return "";
  if (name === "bash" && args.command) {
    const cmd = args.command;
    return cmd.length > 60 ? `"${cmd.slice(0, 57)}…"` : `"${cmd}"`;
  }
  if ((name === "read" || name === "edit" || name === "write") && (args.filePath || args.path)) {
    return args.filePath ?? args.path;
  }
  if (name === "glob" && args.pattern) {
    return args.pattern;
  }
  if (name === "grep" && args.pattern) {
    return `/${args.pattern}/`;
  }
  // Generic: show first string-valued arg
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > 0) {
      const s = v.length > 50 ? v.slice(0, 47) + "…" : v;
      return `${k}="${s}"`;
    }
  }
  return "";
}

// ── Run ──────────────────────────────────────────────────────────────

const events = parseSessionFile(sessionFile);
console.log(dim(`\nFile: ${sessionFile}\n`));
renderSession(events);
console.log("");

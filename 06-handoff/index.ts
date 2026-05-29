/**
 * Handoff — explicit agent-to-agent task delegation
 *
 * /handoff <agent> "<task>" — sends a task to a specialized agent and returns results.
 *
 * Also registers a "handoff" tool so the LLM can delegate mid-conversation:
 *   handoff(agent: "code-reviewer", task: "review the authentication module")
 *
 * Flow:
 *   1. Current context summarized (if needed)
 *   2. Task dispatched to target agent via sub-pi
 *   3. Result returned to main conversation
 *   4. Handoff chain tracked and displayed
 *
 * Agents are configured via .pi/agents/*.md files.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const AGENT_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const HANDOFF_MESSAGE_TYPE = "handoff-result";
const TIMEOUT = 180_000;

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
}

// ── Default agents ──────────────────────────────────────────────────────

function defaultAgents(): AgentConfig[] {
  return [
    {
      name: "code-reviewer",
      description: "Reviews code for quality, bugs, best practices, and security issues",
      systemPrompt: "You are a code reviewer. Analyze code thoroughly and provide specific, actionable feedback. Check for correctness, style, performance, and security. Be constructive and precise.",
    },
    {
      name: "debugger",
      description: "Diagnoses bugs, traces errors, finds root causes",
      systemPrompt: "You are a debugger. Analyze error messages, logs, and code to find root causes. Provide step-by-step diagnosis and clear fix recommendations.",
    },
    {
      name: "refactorer",
      description: "Improves code structure without changing behavior",
      systemPrompt: "You are a refactoring specialist. Improve code structure, readability, and maintainability without changing behavior. Suggest specific changes and explain the rationale.",
    },
    {
      name: "documenter",
      description: "Writes documentation, READMEs, and code comments",
      systemPrompt: "You are a technical writer. Write clear, comprehensive documentation. Include examples, describe interfaces, explain usage patterns.",
    },
    {
      name: "tester",
      description: "Writes and suggests test cases, testing strategies",
      systemPrompt: "You are a testing specialist. Design test cases, identify edge cases, suggest testing strategies. Write tests that are clear, comprehensive, and maintainable.",
    },
  ];
}

// ── Agent discovery ─────────────────────────────────────────────────────

function discoverAgents(cwd: string): AgentConfig[] {
  const agents: AgentConfig[] = [];
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (!fs.existsSync(agentsDir)) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(agentsDir, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(agentsDir, entry.name);
    let content: string;
    try { content = fs.readFileSync(filePath, "utf-8"); } catch { continue; }
    const name = entry.name.replace(/\.md$/, "");
    const descMatch = content.match(/(?:^|\n)#\s*description\s*:\s*(.+)/i);
    const description = descMatch ? descMatch[1].trim() : `Agent: ${name}`;
    const systemPrompt = content.replace(/(?:^|\n)#\s*description\s*:\s*(.*\n?)/, "").trim();
    agents.push({ name, description, systemPrompt });
  }
  return agents;
}

// ── Extension ───────────────────────────────────────────────────────────

export default function handoffExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer(HANDOFF_MESSAGE_TYPE, (message, _options, theme) => {
    return new Text(message.content as string, 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText("Handoff — type /handoff <agent> \"task\" or use the handoff tool");
  });

  // ── Command ──
  pi.registerCommand("handoff", {
    description: "Delegate a task to a specialized agent. Usage: /handoff <agent> \"task\"",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+(?=")/);
      let agentArg = "";
      let task = "";

      if (parts.length >= 2) {
        agentArg = parts[0].trim();
        task = parts.slice(1).join(" ").replace(/^"/, "").replace(/"$/, "");
      } else {
        ctx.ui.notify('Usage: /handoff <agent-name> "your task here"', "error");
        return;
      }

      if (!task) {
        ctx.ui.notify("Task cannot be empty", "error");
        return;
      }

      await executeHandoff(ctx, agentArg, task);
    },
  });

  // ── Tool ──
  pi.registerTool({
    name: "handoff",
    label: "Handoff",
    description: [
      "Delegate a task to a specialized agent and return the result.",
      "Use this when: reviewing code, debugging, refactoring, documenting, or any task",
      "that another specialized agent handles better than you.",
    ].join(" "),
    promptSnippet: "handoff(agent, task) — delegate a task to a specialized agent",
    promptGuidelines: [
      "Use handoff to delegate specialized work to other agents (code-reviewer, debugger, refactorer, documenter, tester).",
      "When reviewing code changes you've made, handoff to 'code-reviewer' rather than reviewing your own work.",
      "When you encounter an error you cannot diagnose, handoff to 'debugger'.",
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Name of the agent to delegate to (e.g., code-reviewer, debugger, refactorer)" }),
      task: Type.String({ description: "The specific task for the agent to complete" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return await executeHandoff(ctx, params.agent, params.task);
    },

    renderCall(args, theme, _context) {
      const preview = (args.task || "").slice(0, 60);
      return new Text(
        theme.fg("toolTitle", theme.bold("handoff → ")) +
        theme.fg("accent", args.agent ?? "?") +
        theme.fg("dim", ` ${preview}${preview.length >= 60 ? "..." : ""}`),
        0, 0,
      );
    },

    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as any;
      const agent = details?.agent ?? "?";
      const success = details?.success ?? true;
      const icon = success ? theme.fg("success", "✓") : theme.fg("error", "✗");
      const output = result.content[0]?.type === "text" ? result.content[0].text : "";
      const preview = expanded ? output : output.slice(0, 200);

      return new Text(
        `${icon} ${theme.fg("accent", theme.bold(agent))}\n${preview}${!expanded && output.length > 200 ? `\n${theme.fg("muted", "..." + " Ctrl+O to expand")}` : ""}`,
        0, 0,
      );
    },
  });

  // ── Core logic ────────────────────────────────────────────────────────

  async function executeHandoff(
    ctx: any,
    agentName: string,
    task: string,
  ): Promise<{ content: Array<{ type: "text"; text: string }>; details: any }> {
    // Discover agents
    const allAgents = discoverAgents(ctx.cwd ?? process.cwd());
    const agents = allAgents.length > 0 ? allAgents : defaultAgents();

    const nameLower = agentName.toLowerCase();
    const agent = agents.find((a) => a.name.toLowerCase() === nameLower) ??
      agents.find((a) => a.name.toLowerCase().includes(nameLower));

    if (!agent) {
      const available = agents.map((a) => a.name).join(", ");
      return {
        content: [{ type: "text", text: `Unknown agent: "${agentName}". Available: ${available}` }],
        details: { agent: agentName, success: false, error: "unknown agent" },
      };
    }

    ctx.ui?.setStatus?.("handoff", `Delegating to ${agent.name}…`);

    try {
      const result = await pi.exec(
        "pi",
        [
          "-p", task,
          "--system-prompt", agent.systemPrompt,
          "--model", AGENT_MODEL,
          "--thinking", "off",
          "--no-extensions",
          "--no-context-files",
          "--no-session",
        ],
        { timeout: TIMEOUT },
      );

      ctx.ui?.setStatus?.("handoff", undefined);

      const output = (result.stdout ?? "").trim();
      pi.sendMessage?.({
        customType: HANDOFF_MESSAGE_TYPE,
        content: `→ handoff to ${agent.name}: ${task.slice(0, 80)}...\n${output.slice(0, 200)}...`,
        display: true,
      });

      return {
        content: [{ type: "text", text: output }],
        details: { agent: agent.name, success: true },
      };
    } catch (err: any) {
      ctx.ui?.setStatus?.("handoff", undefined);
      const errorMsg = err?.message ?? String(err);
      return {
        content: [{ type: "text", text: `Handoff to ${agent.name} failed: ${errorMsg}` }],
        details: { agent: agent.name, success: false, error: errorMsg },
      };
    }
  }
}
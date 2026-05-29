/**
 * Router — intelligent task classification and routing to specialized agents
 *
 * /router "task" — classifies the task with an LLM, then dispatches to the best agent.
 *
 * Flow:
 *   1. LLM classifier analyzes task → picks agent + confidence
 *   2. Selected agent runs via sub-pi
 *   3. (Optional) evaluator checks output, may route to second agent
 *   4. Results rendered with classification reasoning
 *
 * Agents are configured via .pi/agents/*.md files, or inline defaults are used.
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const CLASSIFIER_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const AGENT_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const EVALUATOR_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const MESSAGE_TYPE = "router-result";
const TIMEOUT = 180_000;
const MAX_HOPS = 3; // max routing hops

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
}

interface RoutingDecision {
  agent: string;
  reasoning: string;
  confidence: number;
}

// ── Default agents if no .pi/agents files exist ─────────────────────────

function defaultAgents(): AgentConfig[] {
  return [
    {
      name: "code-writer",
      description: "Writes code, implements features, creates files. Use for: coding tasks, bug fixes, feature implementation, writing scripts.",
      systemPrompt: "You are an expert software engineer. Write clean, well-documented code in response to tasks. Provide complete implementations.",
    },
    {
      name: "code-reviewer",
      description: "Reviews code for quality, bugs, and best practices. Use for: code reviews, auditing, suggesting improvements.",
      systemPrompt: "You are a code reviewer. Analyze code thoroughly and provide specific, actionable feedback on correctness, style, and architecture.",
    },
    {
      name: "architect",
      description: "Designs system architecture and plans. Use for: system design questions, architecture decisions, tradeoff analysis.",
      systemPrompt: "You are a software architect. Design systems, evaluate tradeoffs, and produce clear architecture recommendations with pros and cons.",
    },
    {
      name: "debugger",
      description: "Diagnoses bugs and troubleshoots issues. Use for: debugging, error analysis, root cause investigation.",
      systemPrompt: "You are a debugger. Analyze error messages, logs, and code to find root causes. Provide step-by-step diagnosis and clear fix recommendations.",
    },
    {
      name: "explainer",
      description: "Explains concepts clearly. Use for: explanations, how-it-works questions, documentation.",
      systemPrompt: "You are an educator. Explain technical concepts clearly with examples. Be thorough but accessible.",
    },
  ];
}

// ── Agent discovery ─────────────────────────────────────────────────────

function discoverAgents(cwd: string): AgentConfig[] {
  const agents: AgentConfig[] = [];
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (!fs.existsSync(agentsDir)) return [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(agentsDir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const name = entry.name.replace(/\.md$/, "");
    const descMatch = content.match(/(?:^|\n)#\s*description\s*:\s*(.+)/i);
    const description = descMatch ? descMatch[1].trim() : `Agent: ${name}`;
    const systemPrompt = content.replace(/(?:^|\n)#\s*description\s*:\s*(.*\n?)/, "").trim();

    agents.push({ name, description, systemPrompt });
  }
  return agents;
}

function agentCapabilitiesSummary(agents: AgentConfig[]): string {
  return agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
}

// ── Extension ───────────────────────────────────────────────────────────

export default function routerExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
    return new Text(message.content as string, 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText(`Analyze this Go error: "panic: runtime error: invalid memory address or nil pointer dereference"`);
  });

  pi.registerCommand("router", {
    description: "Classify a task and route it to the best agent. Usage: /router \"task\"",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify('Usage: /router "your task here"', "error");
        return;
      }

      let agents = discoverAgents(ctx.cwd);
      if (agents.length === 0) agents = defaultAgents();
      if (agents.length === 0) {
        ctx.ui.notify("No agents available", "error");
        return;
      }

      ctx.ui.setStatus("router", "Classifying task…");

      const hops: Array<{ decision: RoutingDecision; output: string; success: boolean; error?: string }> = [];

      let currentTask = task;

      for (let hop = 0; hop < MAX_HOPS; hop++) {
        // ── Classification ──
        const classifierPrompt = [
          `You are a task router. Given a task, choose the best agent to handle it.`,
          ``,
          `Available agents:`,
          agentCapabilitiesSummary(agents),
          ``,
          `Task: ${currentTask}`,
          ``,
          `Choose the most appropriate agent. Be decisive. Consider:`,
          `- What type of work does this task require?`,
          `- Which agent's description best matches?`,
          `- If the task is unclear or multi-faceted, pick the agent that can make the most progress.`,
        ].join("\n");

        let decision: RoutingDecision;
        try {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
          if (!auth.ok || !auth.apiKey) throw new Error("No API key available");

          const selectionResult = await complete(
            ctx.model!,
            {
              systemPrompt: "You are an intelligent task router. Choose the best agent for each task.",
              messages: [{ role: "user", content: [{ type: "text", text: classifierPrompt }], timestamp: Date.now() }],
            },
            { apiKey: auth.apiKey, headers: auth.headers },
          );

          // Parse the response for agent name and reasoning
          const responseText = selectionResult.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");

          // Try to extract structured info from response
          const agentName = extractAgentName(responseText, agents);
          const confidence = extractConfidence(responseText);
          const reasoning = responseText.split("\n").slice(0, 3).join(" ").slice(0, 200);

          decision = { agent: agentName, reasoning, confidence };
        } catch {
          decision = { agent: agents[0].name, reasoning: "Fallback: LLM call failed, using default agent", confidence: 0.3 };
        }

        ctx.ui.setStatus("router", `Routing to "${decision.agent}" (hop ${hop + 1})…`);

        // Find the agent
        const agent = agents.find((a) => a.name === decision.agent) ?? agents[0];

        // ── Execute ──
        const agentResult = await spawnAgent(agent, currentTask);

        hops.push({
          decision,
          output: agentResult.output,
          success: agentResult.success,
          error: agentResult.error,
        });

        if (!agentResult.success && hops.length < MAX_HOPS) {
          // Try rerouting on failure
          currentTask = `Previous agent (${decision.agent}) failed: ${agentResult.error}. Retry or find a different approach: ${task}`;
          continue;
        }

        // ── Evaluation (only if there's another hop available) ──
        if (hops.length < MAX_HOPS) {
          ctx.ui.setStatus("router", "Evaluating output…");
          const evalPrompt = [
            `Evaluate whether this task was completed successfully.`,
            ``,
            `Task: ${currentTask}`,
            ``,
            `Agent: ${decision.agent}`,
            `Output: ${agentResult.output.slice(0, 500)}`,
            ``,
            `Reply with either:`,
            `- "COMPLETE" if the task is done`,
            `- "REDIRECT to <agent_name>: <reason>" if another agent should continue`,
          ].join("\n");

          let evalResultText: string;
          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
            if (!auth.ok || !auth.apiKey) throw new Error("No API key");

            const evalResult = await complete(
              ctx.model!,
              {
                systemPrompt: "You are a workflow evaluator. Decide if a task is complete or needs more work.",
                messages: [{ role: "user", content: [{ type: "text", text: evalPrompt }], timestamp: Date.now() }],
              },
              { apiKey: auth.apiKey, headers: auth.headers },
            );

            evalResultText = evalResult.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
          } catch {
            evalResultText = "COMPLETE";
          }

          if (evalResultText.toUpperCase().includes("COMPLETE")) {
            break;
          }

          const redirectMatch = evalResultText.match(/REDIRECT to (\w+)/i);
          if (redirectMatch && redirectMatch[1]) {
            const nextAgent = agents.find((a) => a.name.toLowerCase() === redirectMatch![1].toLowerCase());
            if (nextAgent) {
              currentTask = `Continuing from ${decision.agent}'s work:\n\n${agentResult.output.slice(0, 300)}\n\nContinue or complete this.`;
              continue;
            }
          }
          break;
        }

        break;
      }

      ctx.ui.setStatus("router", undefined);

      // ── Render results ──
      const results = hops.map((h, i) => {
        const icon = h.success ? "✓" : "✗";
        const preview = h.output.slice(0, 200) + (h.output.length > 200 ? "..." : "");
        return `Hop ${i + 1}: ${icon} ${h.decision.agent} (confidence: ${(h.decision.confidence * 100).toFixed(0)}%)\n  Reason: ${h.decision.reasoning.slice(0, 120)}\n  Output: ${preview}`;
      }).join("\n\n");

      pi.sendMessage({
        customType: MESSAGE_TYPE,
        content: `⚡ Router — \"${task}\"\n\n${results}\n\nFinal answer:\n${hops[hops.length - 1].output}`,
        display: true,
      });
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  function extractAgentName(text: string, agents: AgentConfig[]): string {
    const lower = text.toLowerCase();
    for (const agent of agents) {
      if (lower.includes(agent.name.toLowerCase())) return agent.name;
    }
    return agents[0].name;
  }

  function extractConfidence(text: string): number {
    const match = text.match(/(?:confidence|score)[\s:]*(\d+)\s*%?/i);
    if (match) {
      const val = parseInt(match[1], 10);
      return val > 1 ? val / 100 : val;
    }
    return 0.5;
  }

  async function spawnAgent(
    agent: AgentConfig,
    task: string,
  ): Promise<{ success: boolean; output: string; error?: string }> {
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
        {
          timeout: TIMEOUT,
        },
      );
      return { success: true, output: (result.stdout ?? "").trim() };
    } catch (err: any) {
      return {
        success: false,
        output: "",
        error: err?.message ?? String(err),
      };
    }
  }
}
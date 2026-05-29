/**
 * Swarm — parallel agent execution with result aggregation
 *
 * /swarm "task" — runs multiple agents on the same task concurrently, then merges results.
 *
 * Flow:
 *   1. Agents run in parallel via sub-pi (max concurrency 4)
 *   2. Each agent approaches the task independently
 *   3. Aggregator LLM merges/synthesizes all outputs into a final answer
 *   4. TUI shows parallel progress and final merged result
 *
 * Agents are configured via .pi/agents/*.md files, or inline defaults are used.
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const AGENT_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const AGGREGATOR_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const SWARM_MESSAGE_TYPE = "swarm-result";
const SWARM_PROGRESS_TYPE = "swarm-progress";
const TIMEOUT = 180_000;
const MAX_CONCURRENCY = 4;

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  approach?: string; // how this agent approaches problems
}

interface AgentResult {
  agent: string;
  approach: string;
  output: string;
  success: boolean;
  error?: string;
}

// ── Default agents with different approaches ────────────────────────────

function defaultAgents(): AgentConfig[] {
  return [
    {
      name: "pragmatist",
      description: "Focuses on practical, working solutions. Prefers simple, proven approaches.",
      systemPrompt: "You are a pragmatic problem-solver. Give the simplest, most practical solution that works. Avoid over-engineering. Be direct and concise.",
      approach: "pragmatic",
    },
    {
      name: "innovator",
      description: "Focuses on novel and creative solutions. Thinks outside the box.",
      systemPrompt: "You are an innovative thinker. Find creative, novel approaches. Challenge assumptions. Propose elegant solutions others might miss. Be bold but grounded.",
      approach: "innovative",
    },
    {
      name: "analyst",
      description: "Focuses on thorough analysis and edge cases. Systematic and exhaustive.",
      systemPrompt: "You are a thorough analyst. Examine the problem from all angles. Identify edge cases, risks, and tradeoffs. Provide a comprehensive, structured analysis.",
      approach: "analytical",
    },
    {
      name: "minimalist",
      description: "Focuses on minimal, elegant solutions with the least complexity.",
      systemPrompt: "You are a minimalist. Find the simplest possible solution with the least moving parts. Remove all unnecessary complexity. Elegance through simplicity.",
      approach: "minimalist",
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
    const approachMatch = content.match(/(?:^|\n)#\s*approach\s*:\s*(.+)/i);
    const description = descMatch ? descMatch[1].trim() : `Agent: ${name}`;
    const approach = approachMatch ? approachMatch[1].trim() : "general";
    const systemPrompt = content.replace(/(?:^|\n)#\s*(?:description|approach)\s*:\s*(.*\n?)/g, "").trim();
    agents.push({ name, description, systemPrompt, approach });
  }
  return agents;
}

// ── Concurrency limiter ─────────────────────────────────────────────────

async function mapWithLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Extension ───────────────────────────────────────────────────────────

export default function swarmExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer(SWARM_MESSAGE_TYPE, (message, _options, theme) => {
    return new Text(message.content as string, 0, 0);
  });

  pi.registerMessageRenderer(SWARM_PROGRESS_TYPE, (message, _options, theme) => {
    return new Text(theme.fg("muted", message.content as string), 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText("What's the best way to handle error propagation in a distributed system?");
  });

  pi.registerCommand("swarm", {
    description: "Run multiple agents in parallel on the same task and merge results. Usage: /swarm \"task\"",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify('Usage: /swarm "your task here"', "error");
        return;
      }

      let agents = discoverAgents(ctx.cwd);
      if (agents.length === 0) agents = defaultAgents();
      if (agents.length === 0) {
        ctx.ui.notify("No agents available", "error");
        return;
      }

      ctx.ui.setStatus("swarm", `Running ${agents.length} agents in parallel…`);

      pi.sendMessage({
        customType: SWARM_PROGRESS_TYPE,
        content: `🐝 Swarming ${agents.length} agents on: ${task}`,
        display: true,
      });

      // ── Parallel execution ──
      const agentResults: AgentResult[] = [];

      await mapWithLimit(agents, MAX_CONCURRENCY, async (agent, index) => {
        ctx.ui.setStatus("swarm", `Running ${agent.name} (${index + 1}/${agents.length})…`);

        let output: string;
        let success = true;
        let error: string | undefined;

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
          output = (result.stdout ?? "").trim();
        } catch (err: any) {
          success = false;
          error = err?.message ?? String(err);
          output = "";
        }

        agentResults[index] = {
          agent: agent.name,
          approach: agent.approach ?? "general",
          output,
          success,
          error,
        };

        pi.sendMessage({
          customType: SWARM_PROGRESS_TYPE,
          content: `  ${success ? "✓" : "✗"} ${agent.name} (${agent.approach})`,
          display: true,
        });
      });

      // ── Aggregation ──
      ctx.ui.setStatus("swarm", "Aggregating results…");

      const successfulResults = agentResults.filter((r) => r.success);
      let finalOutput: string;

      if (successfulResults.length === 0) {
        finalOutput = `All ${agents.length} agents failed.`;
      } else if (successfulResults.length === 1) {
        finalOutput = `[${successfulResults[0].agent}] ${successfulResults[0].output}`;
      } else {
        // Build aggregation prompt
        const approaches = successfulResults
          .map((r) => `## ${r.agent} (${r.approach})\n${r.output}`)
          .join("\n\n---\n\n");

        const aggPrompt = [
          `Several agents analyzed the same task from different perspectives.`,
          `Synthesize their outputs into a single, comprehensive answer.`,
          ``,
          `Task: ${task}`,
          ``,
          `Agent outputs:`,
          approaches,
          ``,
          `Your synthesis should:`,
          `1. Identify common themes across all responses`,
          `2. Highlight any unique insights specific to certain agents`,
          `3. Resolve any contradictions between responses`,
          `4. Present the best overall answer, combining the strongest elements`,
          ``,
          `Format your synthesis clearly. Mention which agents contributed key insights.`,
        ].join("\n");

        try {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
          if (auth.ok && auth.apiKey) {
            const aggResult = await complete(
              ctx.model!,
              {
                systemPrompt: "You are a synthesis engine. Merge multiple perspectives into one coherent answer. Acknowledge contributors.",
                messages: [{ role: "user", content: [{ type: "text", text: aggPrompt }], timestamp: Date.now() }],
              },
              { apiKey: auth.apiKey, headers: auth.headers },
            );
            finalOutput = aggResult.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
          } else {
            finalOutput = "Cannot aggregate: no API key available.";
          }
        } catch (err: any) {
          finalOutput = successfulResults.map((r) => `### ${r.agent}\n${r.output.slice(0, 300)}`).join("\n\n");
        }
      }

      ctx.ui.setStatus("swarm", undefined);

      // ── Summary ──
      const successCount = successfulResults.length;
      const totalCount = agentResults.length;

      const individualResults = agentResults
        .map((r) => `  ${r.success ? "✓" : "✗"} ${r.agent} (${r.approach}): ${r.output.slice(0, 100)}...`)
        .join("\n");

      pi.sendMessage({
        customType: SWARM_MESSAGE_TYPE,
        content: [
          `🐝 Swarm Results — ${task}`,
          ``,
          `${successCount}/${totalCount} agents succeeded.`,
          ``,
          individualResults,
          ``,
          `─── Synthesized Answer ───`,
          finalOutput,
        ].join("\n"),
        display: true,
      });
    },
  });
}
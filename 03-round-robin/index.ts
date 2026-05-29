/**
 * Round Robin — agents take turns building on shared context
 *
 * /roundrobin "task" --agents agent1,agent2,agent3
 *
 * Agents take turns in fixed order, each receiving the full shared
 * conversation history. Stops after one full cycle or when any agent
 * outputs "DONE".
 *
 * Agents are configured via `.pi/agents/*.md` files or inline config.
 * Falls back to default agents if none specified.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const TURN_MESSAGE_TYPE = "roundrobin-turn";
const SUMMARY_MESSAGE_TYPE = "roundrobin-summary";
const CYCLE_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const TIMEOUT = 180_000;
const MAX_CYCLES = 3;

interface AgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  cwd: string;
}

interface TurnResult {
  agent: string;
  output: string;
  success: boolean;
  error?: string;
  model: string;
}

// ── Default agents ──────────────────────────────────────────────────────

function defaultAgents(cwd: string): AgentConfig[] {
  return [
    {
      name: "planner",
      description: "Creates step-by-step plans from high-level tasks",
      model: CYCLE_MODEL,
      systemPrompt: [
        "You are a planner in a multi-agent team. Your role is to analyze the user's task",
        "and create a clear step-by-step action plan.",
        "",
        "When it is your turn:",
        "1. Review the conversation history to understand the task",
        "2. Create a numbered step-by-step plan",
        "3. If you have nothing to add, or if the task is already complete, reply with: DONE",
        "",
        "Keep your response concrete and actionable. Output DONE when the plan is sufficient."
      ].join("\n"),
      cwd,
    },
    {
      name: "executor",
      description: "Executes individual steps from the plan",
      model: CYCLE_MODEL,
      systemPrompt: [
        "You are an executor in a multi-agent team. Your role is to carry out",
        "the current step from the plan.",
        "",
        "When it is your turn:",
        "1. Review the plan and conversation history",
        "2. Execute the next pending step if there is one",
        "3. Report what you did and what the current state is",
        "4. If there are no pending steps, reply with: DONE",
        "",
        "Be specific about what you accomplished."
      ].join("\n"),
      cwd,
    },
    {
      name: "reviewer",
      description: "Reviews work done so far and suggests improvements",
      model: CYCLE_MODEL,
      systemPrompt: [
        "You are a reviewer in a multi-agent team. Your role is to inspect the team's",
        "output and suggest concrete improvements.",
        "",
        "When it is your turn:",
        "1. Review the full conversation and work done so far",
        "2. Provide specific, actionable feedback",
        "3. If the work looks complete and good enough, reply with: DONE",
        "",
        "Be frank but constructive. Focus on what actually needs fixing."
      ].join("\n"),
      cwd,
    },
  ];
}

// ── Agent discovery from .pi/agents/ files ──

function discoverAgents(cwd: string): AgentConfig[] {
  const agents: AgentConfig[] = [];
  const agentsDir = path.join(cwd, ".pi", "agents");
  if (!fs.existsSync(agentsDir)) return agents;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return agents;
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

    // Parse simple frontmatter: name, description
    const name = entry.name.replace(/\.md$/, "");
    const descMatch = content.match(/(?:^|\n)#\s*description\s*:\s*(.+)/i);
    const description = descMatch ? descMatch[1].trim() : `Agent: ${name}`;
    const systemPrompt = content.replace(/(?:^|\n)#\s*description\s*:.*/, "").trim();

    agents.push({
      name,
      description,
      model: CYCLE_MODEL,
      systemPrompt,
      cwd,
    });
  }

  return agents;
}

// ── Extension ──────────────────────────────────────────────────────────

export default function roundRobinExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer(TURN_MESSAGE_TYPE, (message, _options, theme) => {
    return new Text(message.content as string, 0, 0);
  });

  pi.registerMessageRenderer(SUMMARY_MESSAGE_TYPE, (message, _options, theme) => {
    const text = theme.bold(theme.fg("accent", "═══ Round Robin Complete ═══\n"));
    return new Text(text + (message.content as string), 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText("Round Robin — type /roundrobin \"your task\" to begin");
  });

  pi.registerCommand("roundrobin", {
    description: "Run agents in sequence, each building on shared context. Usage: /roundrobin \"task\"",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify('Usage: /roundrobin "your task here"', "error");
        return;
      }

      // Discover agents
      let agents = discoverAgents(ctx.cwd);
      if (agents.length === 0) {
        agents = defaultAgents(ctx.cwd);
      }
      if (agents.length === 0) {
        ctx.ui.notify("No agents configured and no defaults available", "error");
        return;
      }

      ctx.ui.setStatus("roundrobin", `Running ${agents.length} agents…`);

      const turnResults: TurnResult[] = [];
      const sharedHistory: string[] = [`Task: ${task}`];

      // Phase labels for each cycle
      for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
        if (cycle > 0 && turnResults[turnResults.length - 1]?.output?.trim().toUpperCase().startsWith("DONE")) {
          break;
        }

        for (let i = 0; i < agents.length; i++) {
          const agent = agents[i];
          ctx.ui.setStatus(
            "roundrobin",
            `Cycle ${cycle + 1}/${MAX_CYCLES}, ${agent.name} (${i + 1}/${agents.length})…`,
          );

          const context = [
            ...sharedHistory,
            ``,
            `It is your turn. Here is the context:`,
            sharedHistory.join("\n"),
            ``,
            `What do you want to do or say next? Reply with DONE if complete.`,
          ].join("\n");

          const result = await spawnAgent(agent, context);

          sharedHistory.push(`${agent.name}: ${result.output}`);

          const isDone = result.output.trim().toUpperCase().startsWith("DONE");
          turnResults.push({
            agent: agent.name,
            output: result.output,
            success: result.success,
            error: result.error,
            model: agent.model,
          });

          pi.sendMessage({
            customType: TURN_MESSAGE_TYPE,
            content: `[${agent.name}] ${result.success ? result.output.slice(0, 200) + "..." : `ERROR: ${result.error}`}`,
            display: true,
          });

          if (isDone && cycle > 0) break;
        }
      }

      ctx.ui.setStatus("roundrobin", undefined);

      // Summary
      const summary = turnResults
        .map(
          (t) => `${t.success ? "✓" : "✗"} ${t.agent}: ${t.output.slice(0, 120)}...`,
        )
        .join("\n");

      pi.sendMessage({
        customType: SUMMARY_MESSAGE_TYPE,
        content: `Task: ${task}\n\nTurns completed: ${turnResults.length}\n\n${summary}`,
        display: true,
      });
    },
  });

  async function spawnAgent(
    agent: AgentConfig,
    prompt: string,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    try {
      const result = await pi.exec(
        "pi",
        [
          "-p", prompt,
          "--system-prompt", agent.systemPrompt,
          "--model", agent.model,
          "--thinking", "off",
          "--no-extensions",
          "--no-context-files",
          "--no-session",
        ],
        {
          cwd: agent.cwd,
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
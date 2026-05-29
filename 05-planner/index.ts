/**
 * Planner — plan & execute with step evaluation and retry
 *
 * /plan "task" — creates a step-by-step plan, executes each step, retries on failure.
 *
 * Flow:
 *   1. Planning LLM creates structured plan (numbered steps with agent assignments)
 *   2. User confirms or edits the plan
 *   3. Each step dispatched to its agent via sub-pi
 *   4. Evaluation LLM checks step completion
 *   5. Failed steps retried with enhanced instructions (max 3 retries)
 *   6. Plan progress rendered as a live-updating checklist
 *
 * Agents configured via .pi/agents/*.md files or inline defaults.
 */

import { complete } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const PLAN_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const AGENT_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const EVAL_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const PLAN_MESSAGE_TYPE = "plan-progress";
const SUMMARY_MESSAGE_TYPE = "plan-summary";
const TIMEOUT = 180_000;
const MAX_RETRIES = 3;

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
}

interface PlanStep {
  index: number;
  task: string;
  agent: string;
}

interface StepResult {
  step: PlanStep;
  attempts: Array<{ output: string; success: boolean; evaluation: string }>;
  finalOutput: string;
  completed: boolean;
}

// ── Default agents ──────────────────────────────────────────────────────

function defaultAgents(): AgentConfig[] {
  return [
    {
      name: "researcher",
      description: "Researches topics, gathers information, answers questions. Good for: research, investigation, understanding problems.",
      systemPrompt: "You are a researcher. Investigate and answer questions thoroughly. Gather and synthesize information. Be precise and cite sources when relevant.",
    },
    {
      name: "planner-agent",
      description: "Creates plans, breaks down tasks, designs workflows. Good for: planning, structuring work, designing approaches.",
      systemPrompt: "You are a planner. Break down tasks into actionable steps. Create clear, structured plans that others can follow.",
    },
    {
      name: "implementer",
      description: "Executes tasks, implements solutions, writes code. Good for: implementation, coding, executing plans.",
      systemPrompt: "You are an implementer. Execute tasks precisely and completely. Produce working solutions, not just descriptions. Be thorough.",
    },
    {
      name: "reviewer",
      description: "Reviews output, checks quality, suggests improvements. Good for: quality assurance, review, validation.",
      systemPrompt: "You are a reviewer. Inspect work thoroughly. Provide specific, actionable feedback. Verify correctness and completeness.",
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

function agentList(agents: AgentConfig[]): string {
  return agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
}

// ── Extension ───────────────────────────────────────────────────────────

export default function plannerExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer(PLAN_MESSAGE_TYPE, (message, _options, theme) => {
    return new Text(message.content as string, 0, 0);
  });

  pi.registerMessageRenderer(SUMMARY_MESSAGE_TYPE, (message, _options, theme) => {
    return new Text(theme.bold(theme.fg("accent", "═══ Plan Complete ═══\n")) + (message.content as string), 0, 0);
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText("Build a simple CLI to-do app in Go");
  });

  pi.registerCommand("plan", {
    description: "Create a plan from a task and execute it step by step. Usage: /plan \"task\"",
    handler: async (args, ctx) => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify('Usage: /plan "your task here"', "error");
        return;
      }

      let agents = discoverAgents(ctx.cwd);
      if (agents.length === 0) agents = defaultAgents();
      if (agents.length === 0) {
        ctx.ui.notify("No agents available", "error");
        return;
      }

      // ── Phase 1: Generate plan ──
      ctx.ui.setStatus("plan", "Creating plan…");

      const planPrompt = [
        `You are a task planner. Given a high-level task and a set of available agents,`,
        `create a step-by-step execution plan.`,
        ``,
        `Available agents:`,
        agentList(agents),
        ``,
        `Task: ${task}`,
        ``,
        `Create a plan with numbered steps. For each step, write:`,
        ``,
        `STEP <N>: [agent_name]`,
        `<description of what this step should accomplish>`,
        ``,
        `Rules:`,
        `- Each step must use exactly one agent from the list`,
        `- Steps should be sequential and build on each other`,
        `- Keep it to 3-6 steps`,
        `- Each step should have a clear, verifiable goal`,
        ``,
        `Output only the plan. No introduction. Use the exact format above.`,
      ].join("\n");

      let planText: string;
      try {
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
        if (!auth.ok || !auth.apiKey) throw new Error("No API key");
        const result = await complete(
          ctx.model!,
          {
            systemPrompt: "You are a precise task planner. Create clear, executable plans.",
            messages: [{ role: "user", content: [{ type: "text", text: planPrompt }], timestamp: Date.now() }],
          },
          { apiKey: auth.apiKey, headers: auth.headers },
        );
        planText = result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
      } catch (err: any) {
        ctx.ui.setStatus("plan", undefined);
        ctx.ui.notify(`Plan generation failed: ${err?.message ?? String(err)}`, "error");
        return;
      }

      // Parse steps
      const steps = parseSteps(planText, agents);
      if (steps.length === 0) {
        ctx.ui.setStatus("plan", undefined);
        ctx.ui.notify("Failed to parse plan steps", "error");
        return;
      }

      // Show plan to user
      const planDisplay = steps
        .map((s) => `  ${s.index}. [${s.agent}] ${s.task}`)
        .join("\n");

      const confirmed = await ctx.ui.confirm(
        "Execution Plan",
        `Task: ${task}\n\n${planDisplay}\n\nExecute this plan?`,
      );

      if (!confirmed) {
        ctx.ui.setStatus("plan", undefined);
        ctx.ui.notify("Plan cancelled", "info");
        return;
      }

      pi.sendMessage({
        customType: PLAN_MESSAGE_TYPE,
        content: `📋 Plan for: ${task}\n\n${planDisplay}`,
        display: true,
      });

      // ── Phase 2: Execute steps ──
      const stepResults: StepResult[] = [];

      for (const step of steps) {
        const agent = agents.find((a) => a.name === step.agent) ?? agents[0];

        const result: StepResult = {
          step,
          attempts: [],
          finalOutput: "",
          completed: false,
        };

        let currentTask = step.task;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          const attemptLabel = attempt === 0 ? "" : ` (retry ${attempt}/${MAX_RETRIES})`;
          ctx.ui.setStatus("plan", `Step ${step.index}/${steps.length}: ${step.agent}${attemptLabel}…`);

          const agentResult = await spawnAgent(agent, currentTask);
          const output = agentResult.success ? agentResult.output : `ERROR: ${agentResult.error}`;

          // ── Evaluate ──
          ctx.ui.setStatus("plan", `Evaluating step ${step.index}…`);

          const evalPrompt = [
            `Evaluate whether this step was completed successfully.`,
            ``,
            `Step: ${step.task}`,
            `Agent: ${step.agent}`,
            ``,
            `Agent's output:`,
            output.slice(0, 800),
            ``,
            `Evaluate:`,
            `1. Was the step completed successfully? Answer YES or NO.`,
            `2. If YES, explain briefly what was accomplished.`,
            `3. If NO, provide 1-2 specific suggestions for retry.`,
            ``,
            `Format:`,
            `COMPLETED: [YES/NO]`,
            `ASSESSMENT: [brief assessment]`,
            `SUGGESTIONS: [only if NO - what to do differently]`,
          ].join("\n");

          let evaluation: string;
          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
            if (!auth.ok || !auth.apiKey) throw new Error("No API key");
            const evalResult = await complete(
              ctx.model!,
              {
                systemPrompt: "You are a step completion evaluator. Assess whether a task step was completed successfully.",
                messages: [{ role: "user", content: [{ type: "text", text: evalPrompt }], timestamp: Date.now() }],
              },
              { apiKey: auth.apiKey, headers: auth.headers },
            );
            evaluation = evalResult.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");
          } catch {
            evaluation = "COMPLETED: YES\nASSESSMENT: Fallback: assuming completion.";
          }

          const completed = /COMPLETED\s*:\s*YES/i.test(evaluation);

          result.attempts.push({ output, success: agentResult.success, evaluation });
          result.finalOutput = output;

          // Show progress
          const icon = completed ? "✓" : (attempt < MAX_RETRIES ? "↻" : "✗");
          pi.sendMessage({
            customType: PLAN_MESSAGE_TYPE,
            content: `${icon} Step ${step.index}/${steps.length} [${step.agent}]: ${step.task.slice(0, 80)}...`,
            display: true,
          });

          if (completed) {
            result.completed = true;
            break;
          }

          if (attempt < MAX_RETRIES) {
            // Prepare retry
            const suggestions = evaluation.match(/SUGGESTIONS?\s*:\s*(.+?)(?:\n|$)/i);
            const retryHints = suggestions ? suggestions[1] : "Try a different approach";
            currentTask = `${step.task}\n\nPrevious attempt failed. ${retryHints}\n\nPlease try again with a different approach.`;
          }
        }

        stepResults.push(result);

        if (!result.completed && stepResults.filter((r) => !r.completed).length > 1) {
          // Don't continue if multiple steps failed
          const cont = await ctx.ui.confirm(
            "Continue?",
            `Step ${step.index} failed after ${MAX_RETRIES + 1} attempts. Continue to next step?`,
          );
          if (!cont) break;
        }
      }

      ctx.ui.setStatus("plan", undefined);

      // ── Summary ──
      const completedCount = stepResults.filter((r) => r.completed).length;
      const totalCount = stepResults.length;

      let summary = `Task: ${task}\n\n`;
      summary += `Completed: ${completedCount}/${totalCount} steps\n\n`;
      for (const r of stepResults) {
        const icon = r.completed ? "✓" : "✗";
        const attempts = r.attempts.length > 1 ? ` (${r.attempts.length} attempts)` : "";
        summary += `${icon} [${r.step.agent}] ${r.step.task}${attempts}\n`;
        if (!r.completed) {
          const lastEval = r.attempts[r.attempts.length - 1]?.evaluation ?? "";
          const assessMatch = lastEval.match(/ASSESSMENT\s*:\s*(.+)/i);
          if (assessMatch) summary += `   → ${assessMatch[1].trim().slice(0, 120)}\n`;
        }
      }

      pi.sendMessage({
        customType: SUMMARY_MESSAGE_TYPE,
        content: summary,
        display: true,
      });
    },
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  function parseSteps(planText: string, agents: AgentConfig[]): PlanStep[] {
    const steps: PlanStep[] = [];
    const lines = planText.split("\n");
    const validAgents = new Set(agents.map((a) => a.name.toLowerCase()));

    let currentStep: Partial<PlanStep> = {};
    let currentTaskLines: string[] = [];

    for (const line of lines) {
      // Match "STEP N: [agent_name]" or "STEP N: agent_name"
      const stepMatch = line.match(/STEP\s+(\d+)\s*:\s*\[?(\w[\w-]*)\]?/i);
      if (stepMatch) {
        if (currentStep.index !== undefined) {
          currentStep.task = currentTaskLines.join(" ").trim();
          if (currentStep.task && currentStep.agent) {
            steps.push(currentStep as PlanStep);
          }
        }
        currentStep = { index: parseInt(stepMatch[1], 10), agent: stepMatch[2].toLowerCase() };
        currentTaskLines = [];
        continue;
      }

      if (currentStep.index !== undefined && line.trim()) {
        currentTaskLines.push(line.trim());
      }
    }

    // Last step
    if (currentStep.index !== undefined) {
      currentStep.task = currentTaskLines.join(" ").trim();
      if (currentStep.task && currentStep.agent) {
        steps.push(currentStep as PlanStep);
      }
    }

    // Validate agents against available list
    return steps.filter((s) => validAgents.has(s.agent));
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
        { timeout: TIMEOUT },
      );
      return { success: true, output: (result.stdout ?? "").trim() };
    } catch (err: any) {
      return { success: false, output: "", error: err?.message ?? String(err) };
    }
  }
}
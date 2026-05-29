/**
 * Debate — structured debate between two AI agents
 *
 * /debate "motion" — two agents argue opposing sides, judge picks winner.
 *
 * Flow:
 *   1. Affirmative + Negative run in parallel (opening arguments)
 *   2. Each sees opponent's opening, runs rebuttal in parallel
 *   3. Judge reads all arguments + rebuttals, declares winner
 *   4. Results rendered with formatted debate output
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

const DEBATE_DIR = path.join(__dirname);
const AFFIRMATIVE_DIR = path.join(DEBATE_DIR, "affirmative-system");
const NEGATIVE_DIR = path.join(DEBATE_DIR, "negative-system");
const JUDGE_DIR = path.join(DEBATE_DIR, "judge-system");

const DEBATER_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const JUDGE_MODEL = "openrouter/anthropic/claude-3.5-haiku";
const MESSAGE_TYPE = "debate-result";
const STATUS_TYPE = "debate-status";
const TIMEOUT = 120_000;

export default function debateExtension(pi: ExtensionAPI) {
  // Render debate results in the transcript
  pi.registerMessageRenderer(MESSAGE_TYPE, (message, _options, theme) => {
    const content = message.content as string;
    return new Text(content, 0, 0);
  });

  // Render status updates
  pi.registerMessageRenderer(STATUS_TYPE, (message, _options, theme) => {
    let text = theme.fg("accent", "⚖ ");
    text += theme.fg("muted", message.content as string);
    return new Text(text, 0, 0);
  });

  // Pre-fill editor with a sample on startup
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText(
      "Which is better for building web apps: React or Vue?",
    );
  });

  pi.registerCommand("debate", {
    description: "Run a structured debate between two AI agents, with a judge picking the winner",
    handler: async (args, ctx) => {
      const motion = args.trim();
      if (!motion) {
        ctx.ui.notify("Usage: /debate \"<motion>\"", "error");
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("/debate requires interactive mode", "error");
        return;
      }

      await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
        const run = async () => {
          // ── PHASE 1: Opening Arguments (parallel) ──
          pi.sendMessage({
            customType: STATUS_TYPE,
            content: `Debate begins — ${motion}`,
            display: true,
          });

          ctx.ui.setStatus("debate", "Opening arguments…");
          const [affirmOpening, negOpeningResult] = await Promise.all([
            spawnAgent(AFFIRMATIVE_DIR, DEBATER_MODEL, `${motion}\n\nPresent your opening argument for the AFFIRMATIVE.`),
            spawnAgent(NEGATIVE_DIR, DEBATER_MODEL, `${motion}\n\nPresent your opening argument for the NEGATIVE.`),
          ]);

          const affOpeningText = affirmOpening.success ? affirmOpening.output : `ERROR: ${affirmOpening.error}`;
          const negOpeningText = negOpeningResult.success ? negOpeningResult.output : `ERROR: ${negOpeningResult.error}`;

          // ── PHASE 2: Rebuttals (parallel) ──
          ctx.ui.setStatus("debate", "Rebuttals…");

          const affirmRebuttalPrompt = `${motion}\n\nHere is the NEGATIVE opening argument:\n\n${negOpeningText}\n\nPresent your rebuttal. Address their points directly.`;
          const negRebuttalPrompt = `${motion}\n\nHere is the AFFIRMATIVE opening argument:\n\n${affOpeningText}\n\nPresent your rebuttal. Address their points directly.`;

          const [affirmRebuttal, negRebuttalResult] = await Promise.all([
            spawnAgent(AFFIRMATIVE_DIR, DEBATER_MODEL, affirmRebuttalPrompt),
            spawnAgent(NEGATIVE_DIR, DEBATER_MODEL, negRebuttalPrompt),
          ]);

          const affRebuttalText = affirmRebuttal.success ? affirmRebuttal.output : `ERROR: ${affirmRebuttal.error}`;
          const negRebuttalText = negRebuttalResult.success ? negRebuttalResult.output : `ERROR: ${negRebuttalResult.error}`;

          // ── PHASE 3: Judge ──
          ctx.ui.setStatus("debate", "Judge deliberating…");

          const judgePrompt = [
            `## Motion: ${motion}`,
            ``,
            `## Affirmative Opening`,
            affOpeningText,
            ``,
            `## Negative Opening`,
            negOpeningText,
            ``,
            `## Affirmative Rebuttal`,
            affRebuttalText,
            ``,
            `## Negative Rebuttal`,
            negRebuttalText,
            ``,
            `Please judge this debate and declare a winner.`,
          ].join("\n");

          const judgeResult = await spawnAgent(JUDGE_DIR, JUDGE_MODEL, judgePrompt);
          const verdict = judgeResult.success ? judgeResult.output : `ERROR: ${judgeResult.error}`;

          // ── Render result ──
          ctx.ui.setStatus("debate", undefined);

          const fullOutput = [
            `⚖ ════════════ DEBATE ════════════`,
            ``,
            `Motion: ${motion}`,
            ``,
            `─── Affirmative Opening ───`,
            affOpeningText,
            ``,
            `─── Negative Opening ───`,
            negOpeningText,
            ``,
            `─── Affirmative Rebuttal ───`,
            affRebuttalText,
            ``,
            `─── Negative Rebuttal ───`,
            negRebuttalText,
            ``,
            `─── Judge's Verdict ───`,
            verdict,
            `════════════════════════════════`,
          ].join("\n");

          pi.sendMessage({
            customType: MESSAGE_TYPE,
            content: fullOutput,
            display: true,
          });

          done();
        };

        run().catch((err) => {
          ctx.ui.setStatus("debate", undefined);
          pi.sendMessage({
            customType: STATUS_TYPE,
            content: `Debate failed: ${err?.message ?? String(err)}`,
            display: true,
          });
          done();
        });

        // Return a placeholder — we use sendMessage for all output
        return new Text("⚖ Running debate…", 0, 0);
      });
    },
  });

  // ── helpers ──

  async function spawnAgent(
    systemDir: string,
    model: string,
    prompt: string,
  ): Promise<{ success: boolean; output: string; error?: string }> {
    const systemMdPath = path.join(systemDir, "SYSTEM.md");
    const systemPrompt = fs.readFileSync(systemMdPath, "utf-8").trim();

    try {
      const result = await pi.exec(
        "pi",
        [
          "-p",
          prompt,
          "--system-prompt",
          systemPrompt,
          "--model",
          model,
          "--thinking",
          "off",
          "--no-extensions",
          "--no-context-files",
          "--no-session",
        ],
        {
          cwd: systemDir,
          timeout: TIMEOUT,
        },
      );
      return { success: true, output: (result.stdout ?? "").trim() };
    } catch (err: any) {
      const stderr = err?.stderr ?? "";
      const stdout = err?.stdout ?? "";
      return {
        success: false,
        output: "",
        error: err?.message ?? String(err),
      };
    }
  }
}
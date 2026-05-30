/**
 * Rubric evaluation engine for pi session traces.
 *
 * Parses a session JSONL file and runs a list of named checks against
 * the event stream, producing a structured pass/fail result.
 */

import { parseSessionFile, type SessionEvent } from "../tools/trace-parser.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface RubricCheck {
  name: string;
  check: (events: SessionEvent[]) => { pass: boolean; detail: string };
}

export interface RubricResult {
  passed: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
}

// ── Evaluator ────────────────────────────────────────────────────────

export function evaluateRubric(
  sessionFilePath: string,
  checks: RubricCheck[],
): RubricResult {
  const events = parseSessionFile(sessionFilePath);
  const results = checks.map((c) => {
    const { pass, detail } = c.check(events);
    return { name: c.name, pass, detail };
  });
  return {
    passed: results.every((r) => r.pass),
    checks: results,
  };
}

// ── Built-in check factories ─────────────────────────────────────────

/** At least one custom_message with the given customType. */
export function hasCustomMessage(type: string): RubricCheck {
  return {
    name: `hasCustomMessage("${type}")`,
    check(events) {
      const found = events.some(
        (e) => e.type === "custom_message" && e.customType === type,
      );
      return {
        pass: found,
        detail: found
          ? `Found custom_message with type "${type}"`
          : `No custom_message with type "${type}" found`,
      };
    },
  };
}

/** No assistant messages with stopReason "error". */
export function noErrors(): RubricCheck {
  return {
    name: "noErrors",
    check(events) {
      const errors = events.filter(
        (e) =>
          e.type === "message" &&
          e.message?.role === "assistant" &&
          e.message?.stopReason === "error",
      );
      return {
        pass: errors.length === 0,
        detail:
          errors.length === 0
            ? "No error messages"
            : `Found ${errors.length} error message(s)`,
      };
    },
  };
}

/** At least N assistant messages with stopReason "stop". */
export function minAssistantTurns(n: number): RubricCheck {
  return {
    name: `minAssistantTurns(${n})`,
    check(events) {
      const count = events.filter(
        (e) =>
          e.type === "message" &&
          e.message?.role === "assistant" &&
          e.message?.stopReason === "stop",
      ).length;
      return {
        pass: count >= n,
        detail: `Found ${count} assistant turn(s), need >= ${n}`,
      };
    },
  };
}

/** At least one assistant text block matches the given regex. */
export function contentMatches(pattern: RegExp): RubricCheck {
  return {
    name: `contentMatches(${pattern})`,
    check(events) {
      for (const e of events) {
        if (e.type !== "message" || e.message?.role !== "assistant") continue;
        const content = e.message.content ?? [];
        for (const block of content) {
          if (block.type === "text" && pattern.test(block.text)) {
            return { pass: true, detail: `Matched ${pattern} in assistant text` };
          }
        }
      }
      return { pass: false, detail: `No assistant text matched ${pattern}` };
    },
  };
}

/** A custom_message of the given type has content matching the regex. */
export function customMessageMatches(
  type: string,
  pattern: RegExp,
): RubricCheck {
  return {
    name: `customMessageMatches("${type}", ${pattern})`,
    check(events) {
      for (const e of events) {
        if (e.type !== "custom_message" || e.customType !== type) continue;
        if (pattern.test(e.content ?? "")) {
          return {
            pass: true,
            detail: `custom_message "${type}" matched ${pattern}`,
          };
        }
      }
      return {
        pass: false,
        detail: `No custom_message "${type}" matched ${pattern}`,
      };
    },
  };
}

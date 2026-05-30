/**
 * Pure-data parsing functions for pi session JSONL files.
 *
 * Extracted from trace-viewer.ts so tests and other tools can import
 * the parser without pulling in CLI/rendering code.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Types ────────────────────────────────────────────────────────────

export interface SessionEvent {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  [key: string]: any;
}

// ── Helpers ──────────────────────────────────────────────────────────

function cwdToSessionDir(cwd: string): string {
  // pi replaces / with - and wraps with --
  return `--${cwd.replace(/\//g, "-").replace(/^-/, "")}--`;
}

// ── Public API ───────────────────────────────────────────────────────

export function parseSessionFile(filePath: string): SessionEvent[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const events: SessionEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

export function findLatestSession(cwd: string): string | null {
  const sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");
  const dirName = cwdToSessionDir(cwd);
  const dir = path.join(sessionsBase, dirName);

  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  return files.length > 0 ? path.join(dir, files[0].name) : null;
}

export function findSessionById(sessionId: string): string | null {
  const sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");
  if (!fs.existsSync(sessionsBase)) return null;

  for (const dir of fs.readdirSync(sessionsBase)) {
    const dirPath = path.join(sessionsBase, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const file of fs.readdirSync(dirPath)) {
      if (file.endsWith(".jsonl") && file.includes(sessionId)) {
        return path.join(dirPath, file);
      }
    }
  }
  return null;
}

#!/usr/bin/env npx tsx
"use strict";
/**
 * General-purpose pi session trace viewer.
 *
 * Usage:
 *   npx tsx tools/trace-viewer.ts                  # latest session for cwd project
 *   npx tsx tools/trace-viewer.ts <path>           # specific .jsonl file
 *   npx tsx tools/trace-viewer.ts --full           # no content truncation
 */
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
// ── ANSI helpers (zero dependencies) ─────────────────────────────────
var esc = function (code) { return "\u001B[".concat(code, "m"); };
var reset = esc("0");
var bold = function (s) { return "".concat(esc("1")).concat(s).concat(reset); };
var dim = function (s) { return "".concat(esc("2")).concat(s).concat(reset); };
var green = function (s) { return "".concat(esc("32")).concat(s).concat(reset); };
var blue = function (s) { return "".concat(esc("34")).concat(s).concat(reset); };
var yellow = function (s) { return "".concat(esc("33")).concat(s).concat(reset); };
var red = function (s) { return "".concat(esc("31")).concat(s).concat(reset); };
var cyan = function (s) { return "".concat(esc("36")).concat(s).concat(reset); };
// ── CLI args ─────────────────────────────────────────────────────────
var args = process.argv.slice(2);
var fullMode = args.includes("--full");
var positional = args.filter(function (a) { return !a.startsWith("--"); });
// ── Resolve session file ─────────────────────────────────────────────
function cwdToSessionDir(cwd) {
    // pi replaces / with - and wraps with --
    return "--".concat(cwd.replace(/\//g, "-").replace(/^-/, ""), "--");
}
function findLatestSession(cwd) {
    var sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");
    var dirName = cwdToSessionDir(cwd);
    var dir = path.join(sessionsBase, dirName);
    console.log(dir);
    if (!fs.existsSync(dir))
        return null;
    var files = fs.readdirSync(dir)
        .filter(function (f) { return f.endsWith(".jsonl"); })
        .map(function (f) { return ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }); })
        .sort(function (a, b) { return b.mtime - a.mtime; });
    return files.length > 0 ? path.join(dir, files[0].name) : null;
}
function findSessionById(sessionId) {
    var sessionsBase = path.join(os.homedir(), ".pi", "agent", "sessions");
    if (!fs.existsSync(sessionsBase))
        return null;
    for (var _i = 0, _a = fs.readdirSync(sessionsBase); _i < _a.length; _i++) {
        var dir = _a[_i];
        var dirPath = path.join(sessionsBase, dir);
        if (!fs.statSync(dirPath).isDirectory())
            continue;
        for (var _b = 0, _c = fs.readdirSync(dirPath); _b < _c.length; _b++) {
            var file = _c[_b];
            if (file.endsWith(".jsonl") && file.includes(sessionId)) {
                return path.join(dirPath, file);
            }
        }
    }
    return null;
}
var sessionFile;
if (positional.length > 0) {
    sessionFile = path.resolve(positional[0]);
}
else {
    var found = findLatestSession(process.cwd());
    if (!found) {
        console.error(red("No session files found for current directory."));
        console.error(dim("  Looked in: ~/.pi/agent/sessions/".concat(cwdToSessionDir(process.cwd()), "/")));
        process.exit(1);
    }
    sessionFile = found;
}
if (!fs.existsSync(sessionFile)) {
    console.error(red("File not found: ".concat(sessionFile)));
    process.exit(1);
}
// ── Parse JSONL ──────────────────────────────────────────────────────
function parseSessionFile(filePath) {
    var raw = fs.readFileSync(filePath, "utf-8");
    var events = [];
    for (var _i = 0, _a = raw.split("\n"); _i < _a.length; _i++) {
        var line = _a[_i];
        if (!line.trim())
            continue;
        try {
            events.push(JSON.parse(line));
        }
        catch (_b) {
            // skip malformed lines
        }
    }
    return events;
}
// ── Rendering helpers ────────────────────────────────────────────────
var MAX_LINES = 4;
function truncate(text) {
    if (fullMode)
        return text;
    var lines = text.split("\n");
    if (lines.length <= MAX_LINES)
        return text;
    return lines.slice(0, MAX_LINES).join("\n") + dim("\n  \u2026 (".concat(lines.length - MAX_LINES, " more lines)"));
}
function formatTimestamp(ts) {
    try {
        var d = new Date(ts);
        return d.toLocaleString();
    }
    catch (_a) {
        return ts;
    }
}
function formatCost(cost) {
    if (cost < 0.01)
        return "$".concat(cost.toFixed(6));
    return "$".concat(cost.toFixed(4));
}
function indent(text, prefix) {
    return text.split("\n").map(function (l) { return prefix + l; }).join("\n");
}
// ── Main rendering ───────────────────────────────────────────────────
function renderSession(events, indentLevel) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    if (indentLevel === void 0) { indentLevel = 0; }
    var pad = "  ".repeat(indentLevel);
    var out = function (s) { return console.log(indent(s, pad)); };
    // Stats
    var errorCount = 0;
    var assistantTurns = 0;
    var totalCost = 0;
    // Session header
    var sessionEvt = events.find(function (e) { return e.type === "session"; });
    var modelEvt = events.find(function (e) { return e.type === "model_change"; });
    var thinkingEvt = events.find(function (e) { return e.type === "thinking_level_change"; });
    out(bold("═".repeat(60)));
    if (sessionEvt) {
        out(bold("Session: ") + cyan((_a = sessionEvt.id) !== null && _a !== void 0 ? _a : "unknown"));
        if (sessionEvt.timestamp)
            out(bold("Time:    ") + formatTimestamp(sessionEvt.timestamp));
        if (sessionEvt.cwd)
            out(bold("CWD:     ") + sessionEvt.cwd);
    }
    if (modelEvt) {
        var provider = modelEvt.provider ? "".concat(modelEvt.provider, "/") : "";
        out(bold("Model:   ") + "".concat(provider).concat(modelEvt.modelId));
    }
    if (thinkingEvt) {
        out(bold("Think:   ") + thinkingEvt.thinkingLevel);
    }
    out(bold("═".repeat(60)));
    out("");
    // Track message numbering and pending tool calls
    var msgNum = 0;
    var pendingToolCalls = new Map();
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var event_1 = events_1[_i];
        if (event_1.type === "session" || event_1.type === "model_change" || event_1.type === "thinking_level_change") {
            continue; // already rendered in header
        }
        if (event_1.type === "message") {
            var msg = event_1.message;
            if (!msg)
                continue;
            if (msg.role === "user") {
                msgNum++;
                out(bold(green("\u2500\u2500 [".concat(msgNum, "] USER ")) + green("─".repeat(Math.max(0, 45 - String(msgNum).length)))));
                var textParts = ((_b = msg.content) !== null && _b !== void 0 ? _b : []).filter(function (c) { return c.type === "text"; });
                for (var _q = 0, textParts_1 = textParts; _q < textParts_1.length; _q++) {
                    var part = textParts_1[_q];
                    out(green(truncate(part.text)));
                }
                out("");
            }
            else if (msg.role === "assistant") {
                msgNum++;
                var isError = msg.stopReason === "error";
                if (isError)
                    errorCount++;
                assistantTurns++;
                var cost = (_e = (_d = (_c = msg.usage) === null || _c === void 0 ? void 0 : _c.cost) === null || _d === void 0 ? void 0 : _d.total) !== null && _e !== void 0 ? _e : 0;
                totalCost += cost;
                var label = isError ? red("\u2500\u2500 [".concat(msgNum, "] ASSISTANT (ERROR)")) : blue("\u2500\u2500 [".concat(msgNum, "] ASSISTANT"));
                var separator = isError ? red("─".repeat(40)) : blue("─".repeat(40));
                out(bold(label + " " + separator.slice(0, 40)));
                // Metadata line
                var meta = [];
                if (msg.model)
                    meta.push(msg.model);
                if (msg.stopReason)
                    meta.push("stop=".concat(msg.stopReason));
                if (msg.usage) {
                    var u = msg.usage;
                    meta.push("in=".concat((_f = u.input) !== null && _f !== void 0 ? _f : 0, " out=").concat((_g = u.output) !== null && _g !== void 0 ? _g : 0));
                    if (u.cacheRead)
                        meta.push("cache=".concat(u.cacheRead));
                }
                if (cost > 0)
                    meta.push(formatCost(cost));
                if (meta.length > 0)
                    out(dim("  ".concat(meta.join(" · "))));
                if (isError && msg.errorMessage) {
                    out(red("  ERROR: ".concat(msg.errorMessage)));
                    out("");
                    continue;
                }
                // Content blocks
                var content = (_h = msg.content) !== null && _h !== void 0 ? _h : [];
                var toolCalls = [];
                var hasText = false;
                for (var _r = 0, content_1 = content; _r < content_1.length; _r++) {
                    var block = content_1[_r];
                    if (block.type === "thinking") {
                        out(dim("  [thinking]"));
                    }
                    else if (block.type === "text" && ((_j = block.text) === null || _j === void 0 ? void 0 : _j.trim())) {
                        hasText = true;
                        out(blue(truncate(block.text)));
                    }
                    else if (block.type === "toolCall") {
                        toolCalls.push(block);
                        pendingToolCalls.set(block.id, { name: block.name, args: block.arguments });
                    }
                }
                // Render tool calls as a tree
                if (toolCalls.length > 0) {
                    if (hasText)
                        out(""); // spacer after text
                    for (var i = 0; i < toolCalls.length; i++) {
                        var tc = toolCalls[i];
                        var isLast = i === toolCalls.length - 1;
                        var prefix = isLast ? "└─" : "├─";
                        var argSummary = summarizeToolArgs(tc.name, tc.arguments);
                        out(dim("  ".concat(prefix, " tool: ").concat(tc.name)) + (argSummary ? dim(" ".concat(argSummary)) : ""));
                    }
                }
                out("");
            }
            else if (msg.role === "toolResult") {
                // Tool results — attach to the pending tool call
                var callId = msg.toolCallId;
                var toolInfo = pendingToolCalls.get(callId);
                var toolName = (_l = (_k = msg.toolName) !== null && _k !== void 0 ? _k : toolInfo === null || toolInfo === void 0 ? void 0 : toolInfo.name) !== null && _l !== void 0 ? _l : "unknown";
                pendingToolCalls.delete(callId);
                var textParts = ((_m = msg.content) !== null && _m !== void 0 ? _m : []).filter(function (c) { return c.type === "text"; });
                var resultText = textParts.map(function (c) { return c.text; }).join("\n").trim();
                out(dim("  \u2514\u2500 result (".concat(toolName, "):")));
                if (resultText) {
                    out(dim(indent(truncate(resultText), "     ")));
                }
                out("");
            }
        }
        else if (event_1.type === "custom_message") {
            var customType = (_o = event_1.customType) !== null && _o !== void 0 ? _o : "CUSTOM";
            var label = customType === "critic-feedback" ? "CRITIC" : customType.toUpperCase();
            var content = (_p = event_1.content) !== null && _p !== void 0 ? _p : "";
            out(yellow(bold("\u250C\u2500 ".concat(label, " ").concat("─".repeat(Math.max(0, 55 - label.length))))));
            // Strip subprocess-session markers from display content
            var displayContent = content.replace(/\n?\[subprocess-session:[^\]]+\]/g, "");
            out(yellow(truncate(displayContent)));
            out(yellow(bold("\u2514".concat("─".repeat(58)))));
            // Check for subprocess session marker
            var subMatch = content.match(/\[subprocess-session:([^\]]+)\]/);
            if (subMatch) {
                var subId = subMatch[1];
                var subFile = findSessionById(subId);
                if (subFile) {
                    out("");
                    out(dim("  \u25B6 Subprocess session: ".concat(subId)));
                    var subEvents = parseSessionFile(subFile);
                    renderSession(subEvents, indentLevel + 2);
                    out(dim("  \u25C0 End subprocess session"));
                }
                else {
                    out(dim("  \u26A0 Subprocess session ".concat(subId, " not found")));
                }
            }
            out("");
        }
    }
    // Summary footer
    out(bold("═".repeat(60)));
    out(bold("Summary"));
    out("  Events:          ".concat(events.length));
    out("  Assistant turns:  ".concat(assistantTurns));
    if (errorCount > 0)
        out(red("  Errors:           ".concat(errorCount)));
    if (totalCost > 0)
        out("  Total cost:       ".concat(formatCost(totalCost)));
    out(bold("═".repeat(60)));
}
function summarizeToolArgs(name, args) {
    var _a;
    if (!args)
        return "";
    if (name === "bash" && args.command) {
        var cmd = args.command;
        return cmd.length > 60 ? "\"".concat(cmd.slice(0, 57), "\u2026\"") : "\"".concat(cmd, "\"");
    }
    if ((name === "read" || name === "edit" || name === "write") && (args.filePath || args.path)) {
        return (_a = args.filePath) !== null && _a !== void 0 ? _a : args.path;
    }
    if (name === "glob" && args.pattern) {
        return args.pattern;
    }
    if (name === "grep" && args.pattern) {
        return "/".concat(args.pattern, "/");
    }
    // Generic: show first string-valued arg
    for (var _i = 0, _b = Object.entries(args); _i < _b.length; _i++) {
        var _c = _b[_i], k = _c[0], v = _c[1];
        if (typeof v === "string" && v.length > 0) {
            var s = v.length > 50 ? v.slice(0, 47) + "…" : v;
            return "".concat(k, "=\"").concat(s, "\"");
        }
    }
    return "";
}
// ── Run ──────────────────────────────────────────────────────────────
var events = parseSessionFile(sessionFile);
console.log(dim("\nFile: ".concat(sessionFile, "\n")));
renderSession(events);
console.log("");

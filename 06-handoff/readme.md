# Handoff

## What it does

Explicit task delegation to specialized agents.

- **`/handoff <agent> "<task>"`** — delegates a task to a named agent
- **`handoff` tool** — the LLM can call this mid-conversation for delegation

Usage:
```
/handoff code-reviewer "review the authentication module"
/handoff debugger "diagnose this null pointer error"
/handoff documenter "write docs for the API endpoint"
```

When the LLM uses the `handoff` tool, the delegated agent runs as a sub-pi and its output flows back into the conversation.

## Agent configuration

Custom agents via `.pi/agents/*.md`:

```
.pi/agents/code-reviewer.md:
# description: Reviews code for quality, bugs, and best practices
You are a code reviewer. Analyze code thoroughly...
```

Five defaults are available without configuration: code-reviewer, debugger, refactorer, documenter, tester.

## Project structure

```
06-handoff/
├── index.ts           # Main extension (registers /handoff command + handoff tool)
└── readme.md          # This file
```

## How to run

```bash
just run-06
```

Or directly:

```bash
pi -ne -e ./06-handoff/index.ts
```

Then either:
- Type `/handoff debugger "fix the login bug"`
- Or just describe your task and the LLM will use the `handoff` tool automatically

## Notes

- This pattern mirrors picoagents' HandoffOrchestrator concept
- The `handoff` tool is registered for LLM use — it can delegate mid-conversation
- Agents run on `claude-3.5-haiku` by default
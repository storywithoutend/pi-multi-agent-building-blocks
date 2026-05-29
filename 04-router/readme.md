# Router

## What it does

Intelligent task classification and routing to specialized agents.

- **`/router "<task>"`** — classifies the task and dispatches to the best agent:
  1. **Classification** — LLM analyzes task, picks agent + reasoning + confidence
  2. **Execution** — selected agent runs via sub-pi
  3. **Evaluation** — LLM evaluates output, may redirect to a second agent (up to 3 hops)
  4. Results rendered with routing chain and final answer

## Agent configuration

Custom agents can be defined via `.pi/agents/*.md` files:

```
.pi/agents/code-writer.md:
# description: Writes code and implements features
You are an expert software engineer. [system prompt...]
```

Without custom agents, five defaults are available: code-writer, code-reviewer, architect, debugger, explainer.

## Project structure

```
04-router/
├── index.ts           # Main extension (registers /router)
└── readme.md          # This file
```

## How to run

```bash
just run-04
```

Or directly:

```bash
pi -ne -e ./04-router/index.ts
```

Then type `/router "your task here"`.

## Notes

- Classification and evaluation use LLM calls (structured text parsing)
- Agents run on `claude-3.5-haiku` by default
- Maximum 3 routing hops (classify → execute → evaluate → reroute)
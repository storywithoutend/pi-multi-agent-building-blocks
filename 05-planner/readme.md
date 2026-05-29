# Planner

## What it does

Creates a step-by-step plan from a high-level task, then executes each step with evaluation and automatic retry.

- **`/plan "<task>"`** — runs a four-phase workflow:
  1. **Planning** — LLM creates a structured plan (numbered steps with agent assignments)
  2. **Review** — plan shown to user for confirmation
  3. **Execute** — each step dispatched to its designated agent
  4. **Evaluate** — LLM checks if step succeeded; failed steps retried up to 3 times with enhanced instructions
- Plan progress rendered as a live checklist
- Final summary with completed/failed steps

## Agent configuration

Custom agents can be defined via `.pi/agents/*.md` files (same format as router). Without custom agents, four defaults are available: researcher, planner-agent, implementer, reviewer.

## Project structure

```
05-planner/
├── index.ts           # Main extension (registers /plan)
└── readme.md          # This file
```

## How to run

```bash
just run-05
```

Or directly:

```bash
pi -ne -e ./05-planner/index.ts
```

Then type `/plan "your task here"`.

## Notes

- Plans are generated with 3-6 steps by default
- Each step is evaluated after execution with LLM reasoning
- Failed steps retried up to 3 times with specific suggestions
- Plan execution can be cancelled by the user at any failed step
- All agents and the planner/evaluator run on `claude-3.5-haiku` by default
# Round Robin

## What it does

Agents take turns in fixed order, each receiving the full shared conversation history.

- **`/roundrobin "<task>"`** — runs agents in sequence:
  1. Each agent gets the task + everything previous agents contributed
  2. Agents run in fixed order (cycles repeat up to 3 times)
  3. When any agent outputs "DONE", the loop stops
  4. Summary rendered with each agent's output

## Agent configuration

Custom agents can be defined via `.pi/agents/*.md` files:

```
.pi/agents/planner.md:
# description: Creates step-by-step plans
You are a planner... [system prompt content]
```

If no custom agents exist, three defaults are used: planner, executor, reviewer.

## Project structure

```
03-round-robin/
├── index.ts           # Main extension (registers /roundrobin)
└── readme.md          # This file
```

## How to run

```bash
just run-03
```

Or directly:

```bash
pi -ne -e ./03-round-robin/index.ts
```

Then type `/roundrobin "your task here"`.

## Notes

- Each agent runs on `claude-3.5-haiku` by default (configurable in `index.ts` `CYCLE_MODEL`)
- Max 3 cycles (3 passes through all agents) to prevent infinite loops
- Agents run sequentially to preserve shared context order
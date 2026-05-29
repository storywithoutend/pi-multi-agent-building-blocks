# Swarm

## What it does

Parallel execution of multiple agents on the same task, with result synthesis.

- **`/swarm "<task>"`** — runs multiple agents on the same task concurrently:
  1. **Parallel execution** — all agents run simultaneously (max 4 concurrent)
  2. **Each approaches differently** — pragmatist, innovator, analyst, minimalist
  3. **Aggregation** — LLM synthesizer merges all outputs into one comprehensive answer
  4. Results shown with per-agent contributions and synthesized final answer

## Agent configuration

Custom agents via `.pi/agents/*.md` (supports optional `# approach: ...` frontmatter):

```
.pi/agents/my-agent.md:
# description: My custom agent
# approach: creative
You are a creative problem-solver...
```

Four defaults with distinct approaches are available: pragmatist, innovator, analyst, minimalist.

## Project structure

```
07-swarm/
├── index.ts           # Main extension (registers /swarm)
└── readme.md          # This file
```

## How to run

```bash
just run-07
```

Or directly:

```bash
pi -ne -e ./07-swarm/index.ts
```

Then type `/swarm "your task here"`.

## Notes

- Agents run in parallel with a concurrency limit of 4 to manage API rate limits
- Failed agents are excluded from synthesis, counted in summary
- The aggregator LLM identifies common themes, unique insights, contradictions
- Each agent uses `claude-3.5-haiku` by default (configurable via `AGENT_MODEL` / `AGGREGATOR_MODEL`)
- This pattern is great for brainstorming, tradeoff analysis, and multi-perspective problem solving
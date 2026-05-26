# pi-multi-agent-building-blocks

Building blocks for multi-agent workflows in [pi](https://pi.dev).

## Blocks

### 01-critic — Iterative Review Loop

A self-improving loop powered by a second pi instance acting as a quality critic.

- `/critic` command sends the last assistant message to a sub-pi configured as a reviewer
- If the critic says **approved**, the loop stops
- If not, feedback is injected as a user message so the main LLM revises — up to 8 iterations
- Sub-pi runs on `claude-3.5-haiku` with thinking disabled for speed

```bash
just run-critic
```

## Structure

```
01-critic/
├── index.ts           # Extension (registers /critic, pre-fills editor)
├── readme.md          # Block-specific docs
└── critic-system/     # Sub-pi workspace
    └── SYSTEM.md      # System prompt for the critic sub-pi
```
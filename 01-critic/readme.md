# Critic

## What it does

A self-improving loop powered by a second pi instance acting as a quality critic.

- **On startup** — pre-fills the input with *"Write a haiku about cherry blossoms in spring."*
- **`/critic` command** — sends the last assistant message to a sub-pi instance configured as a reviewer. If the sub-pi says **approved**, the loop stops. If not, the feedback is injected as a user message so the main LLM revises its answer — repeating up to **8 iterations** until approval.

## Project structure

```
01-critic/
├── index.ts           # Main extension (registers /critic, pre-fills editor)
├── readme.md          # This file
└── critic-system/     # Sub-pi workspace
    └── SYSTEM.md      # Instructions for the critic sub-pi
```

## How to run

```bash
just run-01
```

Or directly:

```bash
pi -ne -e ./01-critic/index.ts
```

## Notes

- The `-ne` / `--no-extensions` flag disables all auto-discovered extensions so only this one is loaded.

# Debater

## What it does

A structured debate between two AI agents, with a judge picking the winner.

- **`/debate "<motion>"`** — runs a three-phase debate:
  1. **Opening arguments** — affirmative and negative agents run in parallel
  2. **Rebuttals** — each agent sees the opponent's opening and responds (parallel)
  3. **Judgment** — a judge agent reads all arguments and declares a winner
- Results rendered as a formatted debate transcript in the conversation
- Each agent uses its own `SYSTEM.md` for role-specific behavior

## Project structure

```
02-debater/
├── index.ts                # Main extension (registers /debate)
├── readme.md               # This file
├── affirmative-system/     # Affirmative agent workspace
│   └── SYSTEM.md           # Affirmative debate instructions
├── negative-system/        # Negative agent workspace
│   └── SYSTEM.md           # Negative debate instructions
└── judge-system/           # Judge agent workspace
    └── SYSTEM.md           # Judge evaluation instructions
```

## How to run

```bash
just run-02
```

Or directly:

```bash
pi -ne -e ./02-debater/index.ts
```

Then type `/debate "your topic here"`.

## Notes

- Opening arguments and rebuttals run in parallel for speed
- Agents run on `claude-3.5-haiku` by default (configurable in `index.ts` `DEBATER_MODEL` / `JUDGE_MODEL`)
- The `-ne` / `--no-extensions` flag disables all auto-discovered extensions so only this one is loaded
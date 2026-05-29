# pi-multi-agent-building-blocks

Building blocks for multi-agent workflows in [pi](https://pi.dev).

## Blocks

| # | Block | Pattern | What It Does |
|---|-------|---------|--------------|
| 01 | [critic](./01-critic/) | **Reflection** | Generate → critic reviews → revise loop |
| 02 | [debater](./02-debater/) | **Debate** | Two agents argue positions, judge decides winner |
| 03 | [round-robin](./03-round-robin/) | **Sequential** | Agents take turns building on shared context |
| 04 | [router](./04-router/) | **Routing** | LLM classifies task → dispatches to best agent |
| 05 | [planner](./05-planner/) | **Plan & Execute** | Create plan → execute steps with retry |
| 06 | [handoff](./06-handoff/) | **Explicit Handoff** | Agent delegates to specific named agent |
| 07 | [swarm](./07-swarm/) | **Parallel** | Run N agents concurrently, merge results |

## Running

```bash
just run-01   # critic
just run-02   # debater
just run-03   # round-robin
just run-04   # router
just run-05   # planner
just run-06   # handoff
just run-07   # swarm
```

Or directly: `pi -ne -e ./NN-blockname/index.ts`

## Structure

```
01-critic/                    # Reflection: generate → review → revise
├── index.ts
├── readme.md
└── critic-system/SYSTEM.md

02-debater/                   # Debate: affirmative vs negative + judge
├── index.ts
├── readme.md
├── affirmative-system/SYSTEM.md
├── negative-system/SYSTEM.md
└── judge-system/SYSTEM.md

03-round-robin/               # Sequential: agents take turns
├── index.ts
└── readme.md

04-router/                    # Routing: classify → dispatch → evaluate
├── index.ts
└── readme.md

05-planner/                   # Plan & Execute: plan → execute → retry
├── index.ts
└── readme.md

06-handoff/                   # Handoff: explicit agent delegation
├── index.ts
└── readme.md

07-swarm/                     # Parallel: concurrent agents → merge results
├── index.ts
└── readme.md

justfile
README.md
```
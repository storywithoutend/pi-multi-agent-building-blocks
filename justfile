
# Multi-agent building blocks for pi
# Each block demonstrates a different AI design pattern

# ── 01 critic (reflection) ──
run-01:
	pi -ne -e ./01-critic/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-critic: run-01

# ── 02 debater ──
run-02:
	pi -ne -e ./02-debater/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-debater: run-02

# ── 03 round robin ──
run-03:
	pi -ne -e ./03-round-robin/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-round-robin: run-03

# ── 04 router ──
run-04:
	pi -ne -e ./04-router/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-router: run-04

# ── 05 planner ──
run-05:
	pi -ne -e ./05-planner/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-planner: run-05

# ── 06 handoff ──
run-06:
	pi -ne -e ./06-handoff/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-handoff: run-06

# ── 07 swarm ──
run-07:
	pi -ne -e ./07-swarm/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-swarm: run-07

# ── All ──
run-all: run-01 run-02 run-03 run-04 run-05 run-06 run-07

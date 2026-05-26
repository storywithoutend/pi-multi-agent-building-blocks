
# critic — run pi with only this extension
run-01:
	pi -ne -e ./01-critic/index.ts --model openrouter/anthropic/claude-3.5-haiku --thinking off

run-critic: run-01

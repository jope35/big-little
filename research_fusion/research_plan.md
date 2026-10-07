# Research Plan: Fusion Pattern + OpenCode v2 Plugin Implementation

Main question: How does the Devin Fusion pattern work internally, and how to implement an equivalent opencode v2 compatible plugin for this repo (big-little)?

## Subtopics

1. fusion-core: What is Devin Fusion / Local Fusion? Inner workings from cognition blogs (devin-fusion, local-fusion). Expected: architecture (local model + cloud model split), what runs where, latency/privacy/cost goals, task routing logic, context handling.
2. fusion-ux: How does Fusion behave in Devin Desktop and CLI? From docs.devin.ai/desktop/fusion and docs.devin.ai/cli/fusion. Expected: user-visible modes, triggers, commands, configuration, model selection, fallback behavior.
3. opencode-plugin: How to build an opencode v2 plugin that replicates Fusion routing? From https://opencode.ai/v2/docs/ + plugins guide + this repo (big-little src/, index.js, package.json). Expected: plugin entrypoint shape, hooks/transforms/tools/agents available in v2, how big-little currently does routing, where Fusion routing would hook in.

## Synthesis

Combine into: Fusion mental model in plain terms, routing decision table, minimal opencode v2 implementation sketch reusing big-little patterns, open gaps.

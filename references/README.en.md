# DSH Plugin Development Technical Reference Catalog

This directory contains the authoritative technical specifications, API contracts, and architectural designs for developing plugins in DeepSeek Harness (DSH 0.2.0-rc.2). All documents are calibrated against the latest official specifications and production code.

## Architecture & Documents Index

### 1. Microkernel & Core Spine
- [plugin-anatomy.md](./plugin-anatomy.md): Anatomy of plugins: Function plugins vs. Service class plugins, `name` identification, and `inject` dependencies.
- [services.md](./services.md): The core service spine (`ctx.sessions`, `ctx.tools`, `ctx.agents`, `ctx.llm`, `ctx.systemPrompt`, etc.), service lifecycle, and TypeScript declaration merging.
- [context-api.md](./context-api.md): Cordis Context tree, `ctx.plugin` mounting, `ctx.effect` reversible side effects, and `@deepseek-ai/dsh-scope` isolation.
- [seams.md](./seams.md): Pluggable seams architecture: Service Definition, Provider, and Consumer decoupling.

### 2. Configuration & Patch System
- [config.md](./config.md): Schemastery strong typing, `cordis.patch.yml` authoritative target, wholesale replacement semantics, and deprecation of `settings.yaml`.
- [plugin-forms.md](./plugin-forms.md): Settings forms and configuration editor, entry ID addressing, form descriptors, optimistic concurrency revisions, and atomic persistence.

### 3. Event Bus & Execution Pipeline
- [events.md](./events.md): The 5 Cordis dispatch modes (`emit`, `waterfall`, `parallel`, `serial`, `bail`) and DSH core event taxonomy.
- [tools.md](./tools.md): `ToolRuntime` management, `defineTool` DSL, PTC mode (`presentAs`), monotonic security guards (`guard`), and multimodal `ContentBlock` rendering.
- [llm-adapter.md](./llm-adapter.md): Custom LLM adapter implementation, `LlmRuntime.registerAdapter`, `StreamChunk` protocol, and disjoint token accounting rules.

### 4. Packaging, Workspace & Architecture Roles
- [packaging.md](./packaging.md): Bundles vs. Profiles, `package.json` manifests, and the complete `dsh plugin add` workflow.
- [workspace-package.md](./workspace-package.md): Monorepo multi-package workflow, pnpm workspace development, linking, and live HMR.
- [three-roles.md](./three-roles.md): Browser / Host / Worker physical isolation, Dual-Face plugin standards, SlotRegistry UI injection, and dual-channel IPC networks.

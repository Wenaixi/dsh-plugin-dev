# DeepSeek Harness (DSH) Plugin Development Guide

<p align="center">
  <samp>
    <a href="./README.md">中文</a> ·
    <strong>English</strong>
  </samp>
</p>

This repository is the authoritative knowledge base and standard specification (Agent Skill) for developing, auditing, and debugging plugins and ecosystem extensions for **DeepSeek Harness (DSH 0.2.0-rc.2)**.

DSH is an extensible agent harness built on the Cordis microkernel. In DSH architecture, **Everything is a Plugin**: session logs, tool registries, system prompt assembly, model adapters, user interfaces, and the execution loop itself all run as equal, replaceable plugins.

---

## 1. Core Architectural Principles

1. **Zero-Privilege Microkernel**: There is no privileged core that requires special patching. All business and platform capabilities are provided by mounting services onto the shared `Context` or listening to events.
2. **The Core Spine Services**:
   - `ctx.sessions` (`@deepseek-ai/dsh-session`): Append-only event log and single source of truth.
   - `ctx.systemPrompt` (`@deepseek-ai/dsh-system-prompt`): Prompt assembly and tool schema generation.
   - `ctx.tools` (`@deepseek-ai/dsh-tools`): Tool registry, monotonic security guards, PTC projection, and multimodal rendering.
   - `ctx.agents` (`@deepseek-ai/dsh-agent`): Active agent registry and initiator scope.
   - `ctx.agentLoop` (`@deepseek-ai/dsh-agent-loop`): The default driver implementing the `AgentFactory` contract.
   - `ctx.llm` (`@deepseek-ai/dsh-llm`): Provider-neutral streaming protocol and adapter registry.
   - `ctx.settings` (`@deepseek-ai/dsh-settings`): Configuration forms and patch persistence service.
3. **Five Dispatch Modes**:
   - `emit`: Synchronous broadcast notification, no return value;
   - `waterfall`: Synchronous pipeline modification, returns the final value;
   - `parallel`: `Promise.all` concurrent execution, returns an array of results;
   - `serial`: Sequential `await` execution, returns an array of results;
   - `bail`: Short-circuit interception, stops on first non-`undefined` value.
4. **Configuration Target & Wholesale Replacement**:
   - **Deprecation Notice**: `$DSH_HOME/settings.yaml` is completely deprecated and ignored.
   - **Authoritative Target**: All configurations are stored in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`.
   - **Wholesale Replacement**: Config entries in patches are replaced wholesale, not deep-merged. Complete field sets must be provided when overriding existing entries.
5. **Reversible Effects**: Registrations made through `ctx.on()`, `ctx.effect()`, and `ctx.tools.register()` are tracked by the fiber and automatically unwound when the plugin unloads.

---

## 2. Three-Role Physical Architecture

DSH establishes clean physical boundaries between three execution roles:

| Role | Environment | Responsibilities | Security & Isolation |
| --- | --- | --- | --- |
| **Browser** | Browser / Desktop Webview | React 18 UI, browser-side Cordis runtime, SlotRegistry, localizations | Zero OS/filesystem access, communicates via HTTP RPC & WebSocket |
| **Host** | Persistent Node.js process | Runs core Cordis spine services, tool pipeline, session log persistence, Web server | Full host privileges, manages sensitive credentials and monotonic guards |
| **Worker** | Subprocess (Native Runner) | Executes untrusted shell commands (PowerShell, Bash), sandboxed code, heavy compute | Bound to Windows Job Object / Linux cgroup, crashes do not compromise Host |

UI-bearing plugins follow the **Dual-Face** contract: the Node half provides `lib/index.js` (for loader scanning), and the Browser half provides `lib/client.js` (declared via `dsh.client` and mounted through SlotRegistry).

---

## 3. Technical References Catalog

- [plugin-anatomy.md](./references/plugin-anatomy.md): Anatomy of function and service class plugins, `name`, `inject`, and lifecycle.
- [services.md](./references/services.md): Core service spine, dependency resolution, and TypeScript declaration merging.
- [context-api.md](./references/context-api.md): Cordis context tree, `ctx.plugin`, `ctx.effect`, and scope isolation.
- [seams.md](./references/seams.md): Eight pluggable seams, dependency inversion, and replaceable providers.
- [config.md](./references/config.md): Schemastery validation, `cordis.patch.yml` patch syntax, and wholesale replacement semantics.
- [plugin-forms.md](./references/plugin-forms.md): Settings forms projection, entry ID addressing, optimistic concurrency, and persistence.
- [events.md](./references/events.md): Five Cordis dispatch modes comparison matrix and DSH core event taxonomy.
- [tools.md](./references/tools.md): `ToolRuntime`, `defineTool` DSL, monotonic guards, PTC projection, and multimodal outputs.
- [llm-adapter.md](./references/llm-adapter.md): Custom LLM adapter implementation, `StreamChunk` protocol, and disjoint token accounting.
- [packaging.md](./references/packaging.md): Bundles vs. Profiles, `package.json` manifests, and `dsh plugin add` workflow.
- [workspace-package.md](./references/workspace-package.md): Monorepo multi-package workflow, local linking, and live HMR.
- [three-roles.md](./references/three-roles.md): Browser/Host/Worker physical isolation, Dual-Face UI plugins, and IPC networks.

---

## 4. Practical Examples

- [examples/greet-tool/](./examples/greet-tool/): Minimal model tool using `defineTool`.
- [examples/hello-plugin/](./examples/hello-plugin/): Minimal lifecycle extension using `ctx.effect`.
- [examples/service-provider/](./examples/service-provider/): Custom `Service` class and cross-plugin dependency injection.
- [examples/event-interceptor/](./examples/event-interceptor/): Monotonic security guard (`ctx.tools.guard`) and execution auditing.
- [examples/configurable-plugin/](./examples/configurable-plugin/): Strongly-typed configuration schema using Schemastery.

---

## 5. Getting Started

```bash
# Install bundle into the default web profile
dsh plugin add ./path/to/my-plugin

# Verify the merged configuration tree
dsh --profile web --dump-config

# Launch DSH Web
dsh web
```

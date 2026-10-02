# DeepSeek Harness (DSH) Plugin Development Guide

<p align="center">
  <samp>
    <a href="./README.md">中文</a> ·
    <strong>English</strong>
  </samp>
</p>

This repository is the authoritative knowledge base and standard specification (Agent Skill) for developing, auditing, and debugging plugins and ecosystem extensions for **DeepSeek Harness (DSH 0.2.0-rc.2)**. All content is verified page-by-page against the official documentation site (44 pages); wherever it conflicts with older knowledge, the official text wins.

DSH is an extensible agent harness built on the Cordis microkernel. In DSH architecture, **Everything is a Plugin**: session logs, tool registries, system prompt assembly, model adapters, user interfaces, and the execution loop itself all run as equal, replaceable plugins.

---

## 1. Core Architectural Principles

1. **Zero-Privilege Microkernel**: There is no privileged core. All business and platform capabilities are provided by mounting services onto the shared `Context` or listening to events.
2. **The Core Spine Services** (with official core/seam/bundle roles):
   - `ctx.sessions` (core, `@deepseek-ai/dsh-session`): Append-only event log and single source of truth.
   - `ctx.systemPrompt` (core): Prompt assembly and tool schema generation.
   - `ctx.tools` (core): Tool registry, monotonic guards, PTC projection, and multimodal rendering.
   - `ctx.agents` (core): Active agent registry and initiator scope.
   - `ctx.agentLoop` (**bundle**, `@deepseek-ai/dsh-agent-loop`): The only concrete loop plugin; extension packages depend on dsh-agent events and services, never on this package.
   - `ctx.llm` (**seam**, `@deepseek-ai/dsh-llm`): Provider-neutral streaming protocol and adapter registration.
   - `ctx.settings` + `ctx.configEditor` (core): Settings form projection and patch persistence.
3. **Five Dispatch Modes**:
   - `emit`: Synchronous notification, no return value;
   - `waterfall`: **Synchronous around-middleware** (listeners receive `(...args, next)`; call `next()` to run downstream, return without it to short-circuit), returns the final value — not a plain value chain;
   - `parallel`: `Promise.all` concurrent wait for all settle, no return value;
   - `serial`: Sequential `await`, returns an array;
   - `bail`: Runs in order until a listener returns a bail value.
4. **Configuration Target & Wholesale Replacement**:
   - **Deprecation Notice**: `$DSH_HOME/settings.yaml` is completely deprecated and ignored.
   - **Three-layer targets (+ overlays)**: bundle patches → `$DSH_HOME/profiles/<profile>/cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays (in argv order). Later layers win line-by-line.
   - **Wholesale Replacement**: Config entries in patches are replaced wholesale, not deep-merged.
5. **Reversible Effects**: Registrations made through `ctx.on()`, `ctx.effect()`, and `ctx.tools.register()` are tracked by the fiber and automatically unwound on unload or HMR.

---

## 2. Three-Role Physical Architecture

| Role | Environment | Responsibilities | Security & Isolation |
| --- | --- | --- | --- |
| **Browser** | Browser / Desktop Webview | React UI, browser-side Cordis runtime, Slots, localizations | Zero OS/filesystem access; Typert Remote (HTTP + Remote streams) |
| **Host** | Persistent Node.js process | Core Cordis spine services, tool pipeline, session persistence, Web server | Full host privileges, manages credentials and monotonic guards |
| **Worker** | Subprocess (Native Runner) | Untrusted shell commands, sandboxed scripts, heavy compute | File-effect sandbox (bwrap/Landlock, Seatbelt, Windows ACL); crashes do not compromise Host |

UI plugins follow the **Dual-Face** contract: Node half `lib/index.js`, Browser half `lib/client.js` (declared via `dsh.client` and mounted through Slots; the browser half only attaches to the bare-package-name line).

---

## 3. Technical References Catalog

- [plugin-anatomy.md](./references/plugin-anatomy.md): Plugin anatomy deep module — three forms, Context tree, lifecycle, dispatch modes, role matrix, settings forms (merged context-api/seams/plugin-forms).
- [services.md](./references/services.md): Official service matrix (core/seam/bundle roles), `inject`, Service lifecycle, naming rules.
- [config.md](./references/config.md): Schemastery validation, three-layer patch targets and order, wholesale replacement, settings.yaml deprecation.
- [events.md](./references/events.md): Five dispatch modes (waterfall = around-middleware) and the official event catalog.
- [tools.md](./references/tools.md): Execution pipeline, monotonic guards, schemas whitelist, PTC mode, UI presentation boundary.
- [llm-adapter.md](./references/llm-adapter.md): Adapter registration signature, StreamChunk protocol, token accounting, error contracts.
- [packaging.md](./references/packaging.md): Bundle/Profile mutual exclusion, layer order, git install auth, workspace dev (merged workspace-package).
- [three-roles.md](./references/three-roles.md): Three-role isolation, Dual-Face UI plugins, Slots tree, IPC, sandbox.

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

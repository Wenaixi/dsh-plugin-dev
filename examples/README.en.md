# DSH Plugin Development Examples Library

<p align="center">
  <samp>
    <a href="./README.md">中文</a> ·
    <strong>English</strong>
  </samp>
</p>

This directory contains complete, production-grade examples for developing plugins for DeepSeek Harness (DSH). All examples adhere to the DSH Bundle format, are authored in pure JavaScript (ESM), require zero build steps, and are plug-and-play. Each example demonstrates a specific core capability and lifecycle discipline required by the DSH architecture.

---

## 1. Architecture Decision Matrix

Before creating a DSH plugin, select the lightest and most appropriate architecture pattern:

| Requirement | Recommended Pattern | Core Mechanism & APIs | Example Project | Reference Specification |
| --- | --- | --- | --- | --- |
| Timers, polling, background sync | **Basic Lifecycle Plugin** | `name`, `apply`, `ctx.effect` | [hello-plugin](./hello-plugin) | `references/plugin-anatomy.md` |
| Register new LLM-callable tools | **Model Tool Plugin** | `inject: ['tools']`, `defineTool` | [greet-tool](./greet-tool) | `references/tools.md` |
| Provide shared stateful capabilities | **Service Provider Plugin** | Extend `Service`, `super(ctx, name)` | [service-provider](./service-provider) | `references/services.md` |
| Tool permissions, security, auditing | **Pipeline Middleware Plugin** | `tools/pre-execute` (waterfall), `next()` | [event-interceptor](./event-interceptor) | `references/events.md` |
| Strongly typed options & multi-env | **Configurable Plugin** | `Schemastery`, `!!js` dynamic eval | [configurable-plugin](./configurable-plugin) | `references/config.md` |
| Decoupled capabilities / ecosystem | **Three-Role Architecture** | Definition / Provider / Consumer | `cfbridge` pattern | `references/three-roles.md` |

---

## 2. In-Depth Example Walkthrough

### 1. hello-plugin: Lifecycle Management & Automatic Teardown

- **Directory**: `./hello-plugin`
- **Core Focus**: Demonstrates the minimal plugin entry structure and the "all contributions are effects" principle.
- **Architectural Keys**:
  - Exports `name = 'hello-plugin'` and `apply(ctx)`.
  - Resources not managed by Cordis APIs (e.g. `setInterval`, raw WebSockets, file descriptors) must be enclosed in `ctx.effect(() => { return () => cleanup() })`.
  - When the plugin unloads, hot reloads (HMR), or is explicitly disposed via `fiber.dispose()`, the runtime guarantees invoking the returned disposer, preventing handle leaks.
- **Quick Verification**:
  ```bash
  dsh plugin --profile demo add ./examples/hello-plugin
  dsh --profile demo
  ```

---

### 2. greet-tool: Typed Model Tools & Canonical Values

- **Directory**: `./greet-tool`
- **Core Focus**: Demonstrates registering model tools using the first-party `defineTool` helper.
- **Architectural Keys**:
  - `inject: ['tools']`: Explicitly declares tool registry dependency, ensuring `apply` runs only when the registry is ready.
  - `parameters`: Defines argument schema with runtime validation before `execute` runs.
  - `output.schema` and `output.render`: `execute` returns canonical JSON data (never return raw chat text blocks inside `execute`); text presentation is handled strictly by `output.render`.
  - Obeys `exec.signal`: Handles cancellation and timeout signals gracefully.
- **Quick Verification**:
  ```bash
  dsh plugin --profile demo add ./examples/greet-tool
  dsh --profile demo
  ```

---

### 3. service-provider: Service-Oriented Dependency Injection

- **Directory**: `./service-provider`
- **Core Focus**: Demonstrates exposing reusable, stateful services on the DSH context.
- **Architectural Keys**:
  - Extends `Service` base class: Invokes `super(ctx, 'memoryCache')` in constructor to attach itself to `ctx.memoryCache`.
  - Follows lifecycle: Registers storage cleanup inside `this.ctx.effect`.
  - Safe consumer waiting: Consumers declare `inject: ['memoryCache']`. The Cordis framework holds the consumer in `PENDING` until the service is active, eliminating defensive checks in business logic.
- **Quick Verification**:
  ```bash
  dsh plugin --profile demo add ./examples/service-provider
  dsh --profile demo
  ```

---

### 4. event-interceptor: Pipeline Interception & Security Guards

- **Directory**: `./event-interceptor`
- **Core Focus**: Demonstrates security gates, authorization policies, and immutable audit logging.
- **Architectural Keys**:
  - **Waterfall Pattern**: Hooks into `tools/pre-execute`.
  - **Golden Rule**: Waterfall listeners **must invoke `await next()`**. Returning `{ kind: 'deny', reason: '...' }` short-circuits the pipeline; otherwise `next()` must be called to pass control downstream.
  - **Broadcast Pattern**: Listens to `tools/result` to observe immutable execution outcomes for auditing.
- **Quick Verification**:
  ```bash
  dsh plugin --profile demo add ./examples/event-interceptor
  dsh --profile demo
  ```

---

### 5. configurable-plugin: Schemastery Schema & Dynamic Evaluation

- **Directory**: `./configurable-plugin`
- **Core Focus**: Demonstrates Schemastery configuration schemas and dynamic environment variable evaluation.
- **Architectural Keys**:
  - Exports a matching `Config` Schemastery object (never export a plain JavaScript object).
  - Explicit constraints: Uses `.min()`, `.max()`, `.default()`, and `.description()`.
  - Dynamic evaluation (`!!js`): Demonstrates using `!!js 'process.env.VARIABLE'` in `cordis.patch.yml` to inject environment variables securely without baking secrets into configuration files.
- **Quick Verification**:
  ```bash
  dsh plugin --profile demo add ./examples/configurable-plugin
  dsh --profile demo --dump-config
  dsh --profile demo
  ```

---

## 3. The 8 Hard Rules of DSH Plugin Development

| Rule | Principle | Anti-Pattern | Correct Approach |
| --- | --- | --- | --- |
| 1 | **Generated Interfaces are Authoritative** | Service/event names follow TypeScript interface definitions | Guessing service names like `ctx.toolService` | Using documented contracts like `ctx.tools` |
| 2 | **All Contributions are Effects** | Registrations must be reversible and clean up automatically | Starting `setInterval` in top-level module scope | Wrapping timers in `ctx.effect()` with a disposer |
| 3 | **Waterfall Must Call next()** | Middleware must delegate or return an explicit rejection | Forgetting `return next()`, freezing execution | `const res = await next(); return res;` |
| 4 | **Fail Loudly** | Invalid configs or missing deps must fail loudly | Swallowing errors in empty try-catch blocks | Throwing clear errors or letting Schemastery validate |
| 5 | **Declare Required Services via inject** | Hard deps in `inject`, optional deps via `ctx.get()` | Directly accessing undeclared `ctx.xxx` | `export const inject = ['tools']` |
| 6 | **Configuration Must Use Schemastery** | Export schema matching Config interface with defaults | Exporting plain JS objects as Config | `export const Config = Schema.object({...})` |
| 7 | **Tool execute() Returns Canonical JSON** | Return raw data, delegate presentation to render | Returning text blocks in `execute` | Return JSON value, let `output.render` format |
| 8 | **Model Visible Inputs Must Be Recorded** | Inputs must be replayable in session history | Mutating session context out-of-band | Use event streams or `agent.inject()` |

---

## 4. Developer CLI Quick Reference

```bash
# 1. Add local bundle plugin to profile
dsh plugin --profile demo add ./examples/greet-tool

# 2. Remove plugin from profile
dsh plugin --profile demo remove dsh-greet-tool

# 3. Dump merged active configuration graph
dsh --profile demo --dump-config

# 4. Start DSH Web runtime with profile
dsh --profile demo

# 5. Fast source loop without packaging
pnpm dsh web --patch ./scratch-plugin/cordis.yml

# 6. Verify installation in isolated test profile
$env:DSH_HOME = "C:\Temp\dsh-test"
dsh plugin --profile test-env add ./examples/hello-plugin
dsh --profile test-env --dump-config
```

---

## 5. Troubleshooting & FAQ

### 1. Plugin stays PENDING and apply() is never invoked
- **Cause**: One or more services declared in `inject` are not available.
- **Resolution**: Verify that plugins providing those services are mounted in `cordis.yml`. If dependency is optional, remove from `inject` and use `ctx.get('serviceName')`.

### 2. Tool execution hangs indefinitely until timeout
- **Cause**: A `tools/pre-execute` listener omitted `return await next()`, causing the pipeline to wait forever.
- **Resolution**: Audit all middleware hooks to ensure `next()` is called in all non-reject branches.

### 3. Startup error: "Invalid configuration"
- **Cause**: YAML configuration violated the Schemastery schema.
- **Resolution**: Run `dsh --profile <name> --dump-config` to inspect values against the `Config` schema.

### 4. Duplicate listeners or leaking timers after HMR
- **Cause**: Global state or listeners declared outside `ctx.effect` or `apply`.
- **Resolution**: Move all registrations inside `apply` and wrap third-party resources in `ctx.effect`.

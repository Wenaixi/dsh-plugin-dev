# event-interceptor

<p align="center">
  <samp>
    <a href="./README.md">中文</a> ·
    <strong>English</strong>
  </samp>
</p>

Event interception and pipeline middleware example (bundle format, plain JavaScript, zero build step). Demonstrates using Cordis's `waterfall` mechanism to guard tool executions and recording audit trails via broadcast events.

## What It Demonstrates

1. **Pipeline Interception (Waterfall)**: Attaching to the `tools/pre-execute` hook, showing delegation via `next()` and short-circuit rejection via `{ kind: 'deny', reason: '...' }`.
2. **Hard Rule Compliance**: Enforcing the official rule: **waterfall listeners must invoke next()**, preventing silent pipeline freezes.
3. **Audit Tracking**: Subscribing to `tools/result` broadcast events to log immutable tool execution results.
4. **Automatic Teardown**: Handlers registered via `ctx.on` are automatically detached when the plugin fiber is disposed.

## References

- `references/events.md` (Five dispatch modes: emit, parallel, bail, serial, waterfall)
- `references/plugin-anatomy.md` (Hook plugins and permission gates)

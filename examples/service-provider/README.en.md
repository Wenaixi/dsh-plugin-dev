# service-provider

<p align="center">
  <samp>
    <a href="./README.md">中文</a> ·
    <strong>English</strong>
  </samp>
</p>

Custom Cordis Service and dependency injection example (bundle format, plain JavaScript, zero build step). Demonstrates how to extend the `Service` base class to expose named capabilities onto the context, and how consumer plugins safely consume them via `inject`.

## What It Demonstrates

1. **Service Provision**: Inheriting from `Service` and calling `super(ctx, 'memoryCache')` in the constructor to mount `ctx.memoryCache`.
2. **Dependency Injection**: Consumer plugins declare `inject: ['memoryCache']`. The Cordis runtime guarantees that `apply` runs only after all required services are ready.
3. **Reversible Effects**: Encapsulating teardown inside `this.ctx.effect()`, automatically clearing cache storage and timers upon unload or hot reload.

## Installation and Quick Start

```bash
# Add to profile
dsh plugin --profile demo add ./examples/service-provider

# Verify patch overlay
dsh --profile demo --dump-config

# Run and inspect logs
dsh --profile demo
```

## References

- `references/services.md` (Service base class and optional/required dependencies)
- `references/plugin-anatomy.md` (Lifecycle and effects)
- `references/three-roles.md` (Three-role architecture: Definition, Provider, Consumer)

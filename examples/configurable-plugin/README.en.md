# configurable-plugin

<p align="center">
  <samp>
    <a href="./README.md">中文</a> ·
    <strong>English</strong>
  </samp>
</p>

Standard configuration and Schemastery validation example (bundle format, plain JavaScript, zero build step). Demonstrates exporting Schema definitions according to DSH hard rules, passing overrides in YAML, and dynamically interpolating environment variables with `!!js`.

## What It Demonstrates

1. **Typed Schema**: Exporting a named `Config` Schemastery object with types, defaults, numeric range boundaries (`min`/`max`), and field descriptions.
2. **Hard Rule 6 Compliance**: Strictly adopting Schemastery instead of plain objects, fulfilling Cordis's Standard Schema interface requirements.
3. **Nested Structures**: Demonstrating automatic default assignment and parsing for nested configuration objects.
4. **Dynamic Environment Variables**: Demonstrating `!!js` YAML tags in `cordis.patch.yml` to safely read tokens and URLs from `process.env`.

## References

- `references/config.md` (Configuration definition and Schema validation)
- `references/packaging.md` (Bundle patch YAML conventions)

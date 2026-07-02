# Contributing

Thanks for helping improve `@naughtyjs/proberesponder`.

## Development flow

1. Fork and clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Validate changes:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

4. Update docs and tests with any behavior change.
5. Open a pull request using the provided template.

## Style and quality

- TypeScript strict mode is required.
- Keep public API changes documented in README and ADRs under `docs/adrs`.
- Prefer additive changes over breaking changes for `0.x` releases.
- Ensure coverage thresholds pass via `npm run test:coverage`.

## Commit style

Use concise Conventional Commit-style messages where possible:

- `feat: ...`
- `fix: ...`
- `docs: ...`
- `chore: ...`

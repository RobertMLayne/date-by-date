# Dependency security maintenance

The dependency repair was validated against this repository's public source at
`62e8484760e2807f8b7a2c2fd678b1fe75ae3f6b`. It changes the dependency graph and adds
compatibility tests; application source, Worker configuration, schema, and
applied migrations remain unchanged.

## Selected dependency paths

The Cloudflare Vite plugin is pinned to `1.42.0` with Wrangler `4.102.0` and the
matching Workers types `4.20260617.1`. These parents retain Miniflare 4 and select
patched esbuild `0.28.1` and ws `8.21.0`. Miniflare's Undici dependency is scoped
to `7.29.1` through an override. Next and its ESLint configuration move together
to `16.3.6`; React, React DOM, and React Server DOM Webpack move together to
`19.2.8`. Vite moves to `8.3.1`, also proposed in the existing Dependabot PR.
The lockfile also refreshes vulnerable transitive packages within their existing
parent ranges.

There are three scoped overrides in addition to the existing Sharp override:

- `miniflare > undici: 7.29.1` applies a security patch while retaining the
  selected Miniflare 4 runtime. Local HTTP, D1, and WebSocket probes passed.
- `vinext > image-size: 2.0.3` applies a patch to the dependency pinned by the
  existing Vinext beta. The PNG decoding API is covered by a compatibility test;
  Vinext remains at `1.0.0-beta.5`.
- `@esbuild-kit/core-utils > esbuild: 0.25.12` repairs the deprecated loader path
  used by Drizzle Kit `0.31.10`. This is outside core-utils' published
  `~0.18.20` range. It is a tested local compatibility mitigation, not an
  upstream support guarantee. The published Drizzle Kit `0.31.11` dependency
  graph still includes the deprecated loader, so merely upgrading that parent
  does not remove this path. A future loader migration must preserve schema
  loading and migration generation before this override is removed.

The durable tests exercise core-utils' actual synchronous and asynchronous
transforms, TypeScript semantics, the project's schema and configuration,
and the legacy ESM loader's import of the SQLite schema. They execute only
literal synthetic fixtures and do not connect to an application database.
For this repair, generating SQL from the same schema with the original and
repaired dependency graphs produced byte-identical SQL. Applied migration files
were not rewritten.

Relevant upstream security information includes the esbuild
[development-server advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)
and [later patch advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-g7r4-m6w7-qqqr),
[Undici](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5),
[ws](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p),
[Next](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j),
and [React Server Components](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g).
An affected dependency does not by itself establish that every advisory's
attack path is reachable in this application.

## Reproduce the checks

Use the checked-in lockfile and the project's existing install command:

```sh
npm run install:ci
npm audit --package-lock-only --audit=true
npm test
npm run typecheck
npm run build
npm run lint
```

The explicit `--audit=true` enables the audit despite this repository's existing
`.npmrc` setting. On Node `24.19.0` and npm `11.17.0`, the original lockfile
reported 21 affected package entries, while the repaired lockfile reported zero
at validation time. The repaired graph passed all 33 tests, type checking, the
Vinext build, and a Worker bundle dry-run. A successful dry-run does not establish
a production deployment or remote binding access.

The full lint command reports the same pre-existing 82 errors and 12 warnings
on both dependency graphs. The new compatibility test passes ESLint. This
repair does not suppress those findings or claim that the full lint gate passes.
The installer also reports unapproved native-package lifecycle scripts
under npm's existing policy; no script approval settings were changed, and the
available binaries passed the checks above.

For an isolated SQL comparison, generate to separate empty directories with
explicit schema and dialect arguments. Providing command-line options switches
Drizzle Kit to its CLI configuration, so `--out` alone is insufficient:

```sh
npm run db:generate -- --schema ./db/schema.ts --dialect sqlite --out /path/to/empty/output --name dependency_probe
```

For normal development, retain the existing `npm run db:generate` command and
`drizzle.config.ts`. Follow the README's migration procedure and never rewrite
applied migrations. The [Drizzle generation reference](https://orm.drizzle.team/docs/drizzle-kit-generate)
and [esbuild API reference](https://esbuild.github.io/api/#transform) describe
the interfaces exercised by the compatibility checks.

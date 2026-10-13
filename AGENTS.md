# Kivo project guidance

## Architecture and separation of concerns

The canonical architecture plan is [docs/architecture.md](docs/architecture.md#crate-and-process-boundaries). Read it before adding a backend capability or changing a process boundary.

- Every independently runnable Rust process has its own executable crate, configuration, startup/shutdown lifecycle, health reporting where applicable, and tests. Executable crates compose libraries; they never import another executable's implementation.
- Give independently evolving capabilities cohesive library crates with narrow public contracts. Keep business rules, application workflows, transports and provider implementations separate. Use modules inside a capability for closely related concerns; introduce a crate when ownership or dependency isolation warrants it.
- Keep Axum/HTTP, SQLx, Redis clients and the S3 SDK out of capability contracts and pure business rules. Provider crates implement capability-owned ports; process entrypoints select and inject implementations explicitly.
- Plug-and-play means adapters can be replaced against a tested contract. Use explicit configuration and constructor injection. Do not introduce service locators, string-based dispatch, arbitrary runtime plugins, or a broad shared `utils`/`common` crate.
- Preserve atomic tenant authorization, version checks, mutation and audit writes. A crate boundary must not split one PostgreSQL transaction into separately committed repository calls or network requests. Redis remains non-authoritative.
- Dependencies must form an acyclic graph. Each crate declares only the dependencies it uses; shared dependency versions belong in the Cargo workspace. Keep public APIs small and use typed commands, results and errors.
- Each capability owns its schema changes and contract tests. One migration executable applies the globally ordered migration stream; hosted API replicas must not race to migrate. Preserve already-applied migration contents/checksums during extraction.
- Frontend feature modules follow the same ownership boundaries: components render and collect input, domain modules calculate/validate, and storage adapters perform I/O. Share the Quiet Canvas primitives without growing a catch-all workspace/editor component for every feature.
- Before implementing a feature, identify its owning crate/module, public contract, data owner and transaction boundary. Update the architecture plan when those boundaries change. Prove adapter semantics with focused contract/integration tests rather than adding abstraction without a consumer.

The backend now uses the root Cargo workspace: `apps/api`, `apps/migrator` and `apps/realtime` compose the nine library crates under `crates/`. Run `npm run check:boundaries` and `cargo test --locked --workspace` when changing crate contracts. Migration SQL lives in `apps/migrator/migrations`; never edit an applied migration. Create future executable crates when their process is actually built, with no empty service scaffolding.

## Product design

The canonical theme is **Quiet Canvas**, documented in [docs/design-system.md](docs/design-system.md). Read it before changing any user-facing screen or interaction. Use the shared tokens in `apps/web/src/app/globals.css` and preserve the continuous canvas, contextual toolbar, centered composer, restrained color, and progressive disclosure across the whole product. Do not reintroduce nested dashboard cards or parallel visual themes.

Verify interface work in the actual browser at desktop and mobile sizes, including the affected interactions. Preserve tenant isolation, persistence/error behavior, keyboard access, and reduced-motion support. Product documentation and `docs/validation.md` distinguish implemented development features from future production capabilities.

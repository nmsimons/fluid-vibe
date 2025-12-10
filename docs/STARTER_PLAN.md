# Fluid + React + Tailwind + Vite Starter Conversion Plan

## Goals

- Produce a minimal, opinionated starter that demonstrates SharedTree, Presence API, Semantic Editing (LLM-in-the-loop), and the repo’s React invalidation patterns.
- Keep Vite + React + Tailwind + TypeScript as the default stack with tiny UI examples and clear extension points.
- Make it easy for an LLM and humans to follow: small surface area, clear file boundaries, docstrings, and tests.

## Target End State

- Simple data model in SharedTree: shared `title`, `items` list with `text`, `done`, and `author` fields.
- Presence: join/leave, cursor/selection, simple avatar list.
- Semantic editing: mock LLM client with `suggestEdit` that proposes edits to `items`; swap-in real endpoint via env.
- React layer: `FluidProvider` + hooks (`useSharedTreeState`, `usePresenceState`, `useSemanticEdits`) with batched invalidation.
- UI: one-page app with header, shared list, presence bar, and “Ask AI to tidy” button.
- Tooling: Vite dev/build, Tailwind v4, Vitest unit test for SharedTree helpers, Playwright smoke test.

## Phased Work

1. **Baseline & Cleanup**
    - Keep Vite/TS configs; prune unused scripts/deps once new surface is live.
    - Remove demo-specific assets/pages/tests after the starter path runs.

2. **Data & Container Schema**
    - Define `containerSchema` with a single `SharedTree` (`appTree`).
    - Add `starterSchema.ts` (title + items array) and `appTreeConfiguration` setup helper.
    - Provide `sharedTreeClient.ts` with init/attach + typed CRUD helpers.

3. **Presence Layer**
    - Add `presenceClient.ts` wrapping `@fluidframework/presence` with workspace, `participants`, `updatePresence`, `dispose`.
    - React hook `usePresenceState` that subscribes and batches updates.

4. **Semantic Editing Layer**
    - Add `llmClient.ts` with mock implementation + env-driven adapter hook point.
    - Provide `applySemanticEdit.ts` helper to map LLM suggestions onto SharedTree mutations.

5. **React Scaffolding & UI**
    - Add `contexts/FluidContext.tsx` to expose container, tree, presence, undo.
    - Hooks: `useSharedTreeState(selector)`, `useSharedTreeActions`, `usePresenceState`, `useSemanticEditing`.
    - Components: `App.tsx` (layout), `Header`, `PresenceBar`, `ItemList`, `LLMCommandBar`.
    - Keep Tailwind utilities minimal (`index.css` reset + a few utility classes).

6. **Start Entry Points**
    - Simplify `index.tsx` to load a single `startStarter()` entry.
    - `start/starterStart.ts`: choose local or Azure client via env, call `bootstrapStarterApp()`.
    - Keep `localStart` path; Azure path reduced to minimal auth placeholder (AAD/Relay env stubs).

7. **Testing & Scripts**
    - Vitest: unit test for `sharedTreeClient` CRUD + semantic edit application.
    - Playwright: smoke test loads page, shows shared title and one presence user.
    - npm scripts: `dev`, `dev:local`, `dev:azure`, `test`, `test:e2e`, `lint`, `build`.

8. **Docs**
    - Update `README.md` with quickstart, architecture, how to swap LLM backend, how to add new fields.
    - Add `docs/SEMANTIC_EDITING_STARTER.md` for the LLM contract + examples.

## Execution Order (short-term)

- Implement new starter path alongside existing code (non-destructive), prove it runs locally.
- Wire `index.tsx` to the starter path.
- Trim obvious unused demo pieces after starter is green; then prune dependencies.

## Open Decisions (to revisit after initial cut)

- Whether to keep Fluent UI or move to bare Tailwind components (initial cut will drop Fluent for simplicity).
- How much of Azure auth to retain—initial cut keeps local + stubbed Azure path with env placeholders.

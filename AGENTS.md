# Align App Agent Handoff

## Current Bug Context

The reported issue was: completing a task under an ongoing goal appeared to do nothing, and adding another task/habit made the ongoing goal feel worse.

The relevant UI is the mixed goal -> task/habit list in `src/App.tsx`. Supabase stores both one-off tasks and repeatable habits in the `public.habits` table, differentiated by `kind`.

## Fix In Progress

Local changes currently address:

- Normalize `completions` on read/write so bad Supabase JSON such as `{}` does not break array-based habit logic.
- Load `habits` ordered by `id` so mixed task/habit rows do not jump around between reloads.
- Initialize new action rows with `completions: []` in both the Align and Today add flows.
- Update ongoing goal health so recent completed tasks are an explicit health signal, while open tasks remain only a modest focus signal.
- Preserve a tiny nonzero floor for real stale ongoing activity after focus adjustment.

Primary files:

- `src/App.tsx`
- `src/App.health.test.ts`

## Verification

Use a Node version compatible with the project lockfile. The bundled Codex runtime worked:

```bash
env PATH=/Users/patrickbarfoot/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm test -- --run
env PATH=/Users/patrickbarfoot/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
```

Verified results before this handoff:

- `npm test -- --run`: 4 tests passed.
- `npm run build`: passed.

## Supabase Notes

Supabase project discovered during debugging:

- Project name: `Align`
- Project ref: `hossofghephkcncecesp`
- Relevant tables: `public.goals`, `public.habits`

Observed live data had at least one task row with `completions: {}` while most rows had `completions: []`. The code fix normalizes this locally; no live data migration has been applied.

## Cleanup Notes

`node_modules/`, `dist/`, `*.tsbuildinfo`, and `.npm-cache/` are generated and should not be committed.

## Remaining Choices

- Decide whether to commit and push these local changes to `pbarfoo/Align_App`.
- Decide whether to add a Supabase data cleanup migration/query to convert non-array `habits.completions` values to `[]`.
- If UX still feels off, tune `computeOngoingHealth` weights rather than changing completion persistence again.

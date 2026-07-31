# Version Control Workflow

This project should keep a clean checkpoint history so design and algorithm changes can be reverted easily.

## Commit Cadence

Create a commit after each meaningful project step:

- New user-facing feature or screen.
- Major algorithm change.
- Integration change such as Spotify, Beatport, Apple Music, SoundCloud, or Serato import/export.
- Visual redesign pass.
- Data model or catalog ingestion change.
- Test suite or build system change.

Avoid committing generated folders such as `node_modules/` and `dist/`.

## Suggested Commit Message Style

Use short imperative messages:

```txt
Add Spotify playlist export
Tune transition scoring weights
Redesign setlist timeline
Import Serato library metadata
```

## Reverting

Use Git history to inspect older versions:

```bash
git log --oneline
git show <commit>
```

To temporarily view an old version, create a branch from it:

```bash
git switch -c compare-old-version <commit>
```

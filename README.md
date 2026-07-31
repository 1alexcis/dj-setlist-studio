# DJ Setlist Studio

DJ Setlist Studio is a local-first webapp for planning EDM DJ sets from a natural-language brief, DJ style references, harmonic-mixing constraints, BPM ramps, phrase-ready transitions, and SoundCloud export.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## SoundCloud Export

Create a SoundCloud developer app and set:

```bash
cp .env.example .env
```

Then fill in `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`, and the redirect URI registered with SoundCloud. The app uses OAuth 2.1 with PKCE, stores the token only in the local dev server process, and calls SoundCloud to create a playlist from tracks that have SoundCloud IDs.

The demo catalog includes placeholder SoundCloud IDs for UI testing. Real export requires replacing demo tracks with authenticated SoundCloud search results or imported library metadata.

## Core Algorithm

The planner combines:

- Prompt parsing for genre, duration, crowd, speed, key policy, DJ references, and energy arc.
- Track feature scoring across BPM, Camelot key, energy, density, vocal level, groove, intro/outro bars, popularity, and waveform shape.
- A pairwise logistic transition model trained from reference DJ-style sequences with random negative transitions.
- Beam search over whole-set candidates to optimize duration, harmonic compatibility, energy arc, style similarity, genre movement, and transition readiness.

See [docs/research.md](docs/research.md) for the research notes behind the model.

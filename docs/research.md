# DJ Setlist Optimization Research Notes

These notes describe the first implementation and the direction for a production-grade ML setlist engine.

## Current Platform Constraints

- SoundCloud now uses OAuth 2.1 with PKCE for user-scoped actions. The local server implements the authorization-code flow and stores tokens in memory for the dev session. Source: [SoundCloud API guide](https://developers.soundcloud.com/docs/api/guide).
- Creating a SoundCloud playlist is supported with `POST /playlists` and a payload containing playlist metadata plus track IDs. Source: [SoundCloud API guide, Creating Playlists](https://developers.soundcloud.com/docs/api/guide) and [SoundCloud OpenAPI repo](https://github.com/soundcloud/api/blob/master/openapi/api.yaml).
- SoundCloud API access requires a registered app, and current docs indicate app registration requires SoundCloud Artist Pro. Source: [SoundCloud API guide](https://developers.soundcloud.com/docs/api/guide).
- Serato DJ Pro can stream SoundCloud when the user has SoundCloud Go+ and Serato DJ Pro 2.5.7 or later. Source: [Serato support](https://support.serato.com/hc/en-us/articles/360000644976-Using-SoundCloud-with-Serato-DJ-Pro).
- SoundCloud offline streaming is not supported inside Serato, and recording sets that use SoundCloud-streamed tracks is not supported. Source: [SoundCloud Help Center, Serato Integration](https://help.soundcloud.com/hc/en-us/articles/360051732133-Serato-Integration).

## Features That Matter For DJ Setlists

Production feature extraction should use an audio analysis pipeline, not just public metadata:

- Rhythm: BPM, beat grid confidence, onset strength, tempogram stability, swing/groove feel.
- Tonal: estimated key, Camelot mapping, chroma stability, mode ambiguity, harmonic confidence.
- Structure: intro/outro length, phrase boundaries, cue-in/cue-out candidates, breakdowns, drops.
- Dynamics: loudness, RMS curve, crest factor, beat-level loudness, energy envelope.
- Texture: vocal probability, bass weight, percussion density, brightness, spectral centroid, MFCC/timbre embeddings.
- Mixability: outro-to-intro energy complement, bassline overlap risk, vocal overlap risk, phrase alignment.

Useful extraction tools:

- `librosa` exposes tempo, beat, chroma, mel spectrogram, tempogram, onset, and spectral tools. Source: [librosa feature extraction docs](https://librosa.org/doc/0.11.0/feature.html).
- Essentia MusicExtractor computes spectral, time-domain, rhythm, tonal, and high-level descriptors in batch. Source: [Essentia MusicExtractor docs](https://essentia.upf.edu/streaming_extractor_music.html) and [MusicExtractor tutorial](https://essentia.upf.edu/tutorial_extractors_musicextractor.html).

## Harmonic Mixing

The app models Camelot compatibility as a graded score instead of a binary rule:

- Highest confidence: same key, adjacent numbers in the same mode, and relative major/minor.
- Guided creative moves: diagonal compatible moves and controlled +2 energy boosts.
- Strict mode filters out anything below the safe Camelot threshold.
- Adventurous mode allows less compatible keys when BPM, phrase, waveform, and style scores compensate.

Sources: [Mixed In Key harmonic mixing guide](https://mixedinkey.com/harmonic-mixing-guide/), [Mixed In Key energy boost guide](https://mixedinkey.com/workflows/change-energy-with-camelot-wheel/).

## ML Strategy

The first version implements a supervised pairwise transition scorer:

1. Treat adjacent tracks in reference DJ-style setlists as positive examples.
2. Sample non-adjacent, weakly compatible pairs as negative examples.
3. Compute feature vectors for harmonic, tempo, energy, phrase, texture, waveform, genre, and style fit.
4. Train a logistic model with heuristic priors.
5. Use the transition probability inside beam search to optimize the whole set against target duration and energy arc.

This follows a practical recommender pattern: retrieve a plausible candidate pool, then rerank with a richer pairwise model. The same two-stage idea appears in playlist continuation research, including pairwise reranking and hybrid recommenders with side information. Sources: [Two-stage Model for Automatic Playlist Continuation at Scale](https://www.cs.toronto.edu/~mvolkovs/recsys2018_challenge.pdf), [Item-Item Music Recommendations With Side Information](https://arxiv.org/abs/1706.00218), [RecSys Challenge 2018 overview](https://research.atspotify.com/publications/recsys-challenge-2018-automatic-music-playlist-continuation).

## DJ-Specific Research Signals

- DJ transitions can be learned from real mixes using differentiable EQ/fader operations and adversarial training. That points toward a future second model that predicts transition automation, not just track order. Source: [Automatic DJ Transitions with Differentiable Audio Effects and GANs](https://arxiv.org/abs/2110.06525).
- Cue point detection is central to autonomous DJ mixing. A feature and novelty-analysis approach reported about 96% usable generated switch points for DJ mixing. Source: [Automatic Detection of Cue Points for DJ Mixing](https://arxiv.org/abs/2007.08411).
- Newer cue-point work frames cue estimation as object detection and emphasizes phrase adherence, with a larger annotated dataset. Source: [Cue Point Estimation using Object Detection](https://arxiv.org/abs/2407.06823).

## Production Roadmap

1. Library ingestion
   - Import Serato library XML/CSV and SoundCloud search results.
   - Store user-confirmed keys/BPM/cue points separately from model-estimated features.

2. Audio feature extraction
   - Use Essentia or librosa for owned/local audio files.
   - For SoundCloud-streamed tracks, avoid ripping or copying audio. Only use API metadata, user-provided metadata, and legally accessible previews/analysis where allowed by SoundCloud terms.

3. Training data
   - Use user playlists, manually entered reference setlists, public metadata where terms allow, and the user's own successful sets.
   - Avoid scraping restricted sites or copying third-party audio.

4. Modeling
   - Upgrade logistic scoring to a gradient-boosted ranker or neural pair encoder once enough data exists.
   - Add DJ-specific embeddings for artist/set style.
   - Add an optional transition-automation model that predicts EQ/fader/filter curves from cue points.

5. Optimization
   - Keep hard constraints for duration, Camelot strictness, maximum pitch shift, and genre-change limits.
   - Use beam search or mixed-integer optimization for whole-set planning.
   - Add regret/novelty controls so the planner can choose between familiar party records and deeper taste-maker picks.

import type {
  DjProfile,
  PlannedTrack,
  SetlistPlan,
  SetlistRequest,
  Track,
  TransitionModel,
  TransitionPlan
} from "../types";
import { describeCamelotMove, isStrictCamelotCompatible } from "./camelot";
import { demoCatalog } from "./demoCatalog";
import { getProfilesById } from "./djProfiles";
import {
  durationForTrack,
  genreAffinity,
  scoreTransitionFeatures,
  targetEnergyAt,
  trackFit,
  trainTransitionModel,
  transitionBeats,
  transitionFeatures,
  transitionOverlapSec,
  transitionPitchPct,
  transitionReasons,
  transitionWarnings
} from "./features";
import { clamp, secondsToClock, weightedAverage } from "./math";

interface CandidateTrack {
  track: Track;
  fit: number;
}

interface BeamState {
  ids: string[];
  plannedTracks: PlannedTrack[];
  durationSec: number;
  score: number;
  genreSwitches: number;
  warnings: number;
}

function candidatePool(request: SetlistRequest, profiles: DjProfile[], catalog: Track[]): CandidateTrack[] {
  return catalog
    .map((track) => ({
      track,
      fit: trackFit(track, request, profiles)
    }))
    .filter(({ track, fit }) => {
      const primaryGenre = request.genres.includes(track.genre);
      const adjacentGenre = request.genres.some((genre) => genreAffinity(genre, track.genre) >= 0.52);
      return primaryGenre || (request.allowGenreChanges && adjacentGenre) || fit >= 0.56;
    })
    .sort((a, b) => b.fit - a.fit)
    .slice(0, request.allowGenreChanges ? 52 : 42);
}

function startScore(candidate: CandidateTrack, request: SetlistRequest, profiles: DjProfile[]): number {
  const desiredEnergy = targetEnergyAt(0.04, request);
  const energyScore = clamp(1 - Math.abs(candidate.track.energy - desiredEnergy) / 0.34);
  const warmupPenalty =
    request.crowdContext !== "frat party" && candidate.track.energy > 0.82 ? 0.22 : 0;
  const profileTagScore = profiles.some((profile) =>
    candidate.track.tags.some((tag) => profile.tags.includes(tag))
  )
    ? 0.08
    : 0;
  return candidate.fit * 2 + energyScore * 1.35 + profileTagScore - warmupPenalty;
}

function transitionRecipe(from: Track, to: Track, request: SetlistRequest, phraseBeats: number): string {
  const harmonicMove = describeCamelotMove(from.camelot, to.camelot);
  const toBrighter = to.brightness - from.brightness > 0.12;
  const bassSwap = to.bassWeight >= from.bassWeight && to.energy >= from.energy;

  if (request.transitionSpeed === "fast") {
    if (bassSwap && phraseBeats <= 32) return "16-bar loop, low-swap on the phrase, release incoming hook";
    if (toBrighter) return "filter outgoing mids, echo the last vocal, drop incoming drums on phrase";
    return "32-beat drum blend, quick EQ swap, cut outgoing bass before the drop";
  }

  if (request.transitionSpeed === "long blends") {
    if (harmonicMove.includes("same") || harmonicMove.includes("relative")) {
      return "64-beat harmonic blend, trade basslines halfway, let pads overlap";
    }
    return "64-beat percussion-led blend, keep melodies separated until the final 16";
  }

  if (from.vocal > 0.42 || to.vocal > 0.42) {
    return "32-bar phrase blend, avoid vocal overlap, bring incoming bass after the hook";
  }
  return "48-beat rolling blend with bass swap at the midpoint";
}

function buildTransitionPlan(
  from: Track,
  to: Track,
  request: SetlistRequest,
  profiles: DjProfile[],
  model: TransitionModel
): TransitionPlan {
  const features = transitionFeatures(from, to, request, profiles);
  const score = scoreTransitionFeatures(features, model);
  const beats = transitionBeats(request.transitionSpeed, from, to);
  const warnings = transitionWarnings(from, to, request, features);

  return {
    fromId: from.id,
    toId: to.id,
    score,
    confidence: clamp(score * 0.78 + (1 - warnings.length * 0.12) * 0.22),
    harmonicMove: describeCamelotMove(from.camelot, to.camelot),
    incomingPitchPct: transitionPitchPct(from, to),
    phraseBeats: beats,
    recipe: transitionRecipe(from, to, request, beats),
    reasons: transitionReasons(features, from, to),
    warnings,
    features
  };
}

function duplicatePenalty(state: BeamState, candidate: Track): number {
  const previousArtists = state.plannedTracks.slice(-3).map((planned) => planned.track.artist);
  const artistPenalty = previousArtists.includes(candidate.artist) ? 0.55 : 0;
  const vocalRun =
    candidate.vocal > 0.45 &&
    state.plannedTracks.slice(-2).every((planned) => planned.track.vocal > 0.38)
      ? 0.28
      : 0;
  const peakRun =
    candidate.energy > 0.84 &&
    state.plannedTracks.slice(-2).every((planned) => planned.track.energy > 0.82)
      ? 0.18
      : 0;
  return artistPenalty + vocalRun + peakRun;
}

function durationPenalty(durationSec: number, targetSec: number): number {
  const diffMin = Math.abs(durationSec - targetSec) / 60;
  return Math.min(2.6, diffMin * 0.2);
}

function isTransitionAllowed(
  from: Track,
  to: Track,
  request: SetlistRequest,
  plan: TransitionPlan
): boolean {
  if (request.harmonicPolicy === "strict" && !isStrictCamelotCompatible(from.camelot, to.camelot)) {
    return false;
  }

  if (request.harmonicPolicy === "guided" && plan.features.harmonic < 0.42 && plan.score < 0.55) {
    return false;
  }

  if (!request.allowGenreChanges && !request.genres.includes(to.genre)) {
    return false;
  }

  const tempoShift = Math.abs(plan.incomingPitchPct);
  if (tempoShift > request.maxTempoShiftPct + 3) {
    return false;
  }

  return true;
}

function expandState(
  state: BeamState,
  candidates: CandidateTrack[],
  request: SetlistRequest,
  profiles: DjProfile[],
  model: TransitionModel,
  targetSec: number
): BeamState[] {
  const previous = state.plannedTracks[state.plannedTracks.length - 1].track;
  const used = new Set(state.ids);

  return candidates
    .filter(({ track }) => !used.has(track.id))
    .slice(0, 44)
    .flatMap((candidate) => {
      const plan = buildTransitionPlan(previous, candidate.track, request, profiles, model);
      if (!isTransitionAllowed(previous, candidate.track, request, plan)) return [];

      const overlap = transitionOverlapSec(request.transitionSpeed, previous, candidate.track);
      const playSec = durationForTrack(candidate.track, request.transitionSpeed);
      const nextDuration = state.durationSec + playSec - overlap;
      if (nextDuration > targetSec + 260) return [];

      const progress = clamp(nextDuration / targetSec);
      const desiredEnergy = targetEnergyAt(progress, request);
      const arcScore = clamp(1 - Math.abs(candidate.track.energy - desiredEnergy) / 0.38);
      const switchPenalty =
        previous.genre !== candidate.track.genre
          ? request.allowGenreChanges
            ? 0.04 + (state.genreSwitches > 2 ? 0.08 : 0)
            : 0.45
          : 0;
      const warningPenalty = plan.warnings.length * 0.08;
      const repetitionPenalty = duplicatePenalty(state, candidate.track);
      const projectedPenalty = durationPenalty(nextDuration, targetSec) * (nextDuration >= targetSec * 0.82 ? 0.6 : 0.08);
      const transitionScore = weightedAverage([
        [plan.score, 1.55],
        [candidate.fit, 1.1],
        [arcScore, 1.1],
        [plan.confidence, 0.6]
      ]);

      const previousPlannedTracks = state.plannedTracks.slice(0, -1);
      const previousWithTransition = {
        ...state.plannedTracks[state.plannedTracks.length - 1],
        transitionToNext: plan
      };

      return [
        {
          ids: [...state.ids, candidate.track.id],
          plannedTracks: [
            ...previousPlannedTracks,
            previousWithTransition,
            {
              track: candidate.track,
              startSec: state.durationSec - overlap,
              playSec,
              targetEnergy: desiredEnergy,
              trackFit: candidate.fit
            }
          ],
          durationSec: nextDuration,
          score:
            state.score +
            transitionScore * 3.2 +
            candidate.fit * 1.3 +
            arcScore * 1.7 -
            switchPenalty -
            warningPenalty -
            repetitionPenalty -
            projectedPenalty,
          genreSwitches: state.genreSwitches + (previous.genre !== candidate.track.genre ? 1 : 0),
          warnings: state.warnings + plan.warnings.length
        }
      ];
    });
}

function finalizeState(state: BeamState, request: SetlistRequest, targetSec: number): SetlistPlan {
  const durationScore = clamp(1 - Math.abs(state.durationSec - targetSec) / Math.max(420, targetSec * 0.16));
  const transitionConfidences = state.plannedTracks
    .map((planned) => planned.transitionToNext?.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");
  const averageTransitionConfidence =
    transitionConfidences.length > 0
      ? transitionConfidences.reduce((sum, confidence) => sum + confidence, 0) / transitionConfidences.length
      : 0.7;
  const averageFit =
    state.plannedTracks.reduce((sum, planned) => sum + planned.trackFit, 0) / state.plannedTracks.length;
  const confidence = clamp(
    weightedAverage([
      [durationScore, 0.8],
      [averageTransitionConfidence, 1.2],
      [averageFit, 0.9],
      [1 - Math.min(0.35, state.warnings * 0.025), 0.5]
    ])
  );
  const score = state.score - durationPenalty(state.durationSec, targetSec) * 4;

  const notes = [
    `Optimized ${state.plannedTracks.length} tracks to ${secondsToClock(state.durationSec)} against a ${request.durationMin}:00 target.`,
    `${transitionConfidences.length} transitions scored with learned pairwise compatibility.`,
    request.harmonicPolicy === "strict"
      ? "Strict Camelot mode filtered out incompatible key jumps."
      : request.harmonicPolicy === "guided"
        ? "Guided Camelot mode allowed only high-confidence outside moves."
        : "Adventurous harmonic mode allowed creative moves when other features were strong.",
    request.allowGenreChanges
      ? `${state.genreSwitches} genre shifts were allowed and penalized only when they disrupted flow.`
      : "Genre changes were disabled."
  ];

  return {
    request,
    tracks: state.plannedTracks,
    totalDurationSec: state.durationSec,
    score,
    confidence,
    summary: `${request.transitionSpeed} ${request.genres.join(" + ")} set with ${request.energyArc} energy for ${request.crowdContext}`,
    optimizerNotes: notes
  };
}

function fallbackState(candidates: CandidateTrack[], request: SetlistRequest, profiles: DjProfile[], model: TransitionModel): BeamState {
  const targetSec = request.durationMin * 60;
  const selected: CandidateTrack[] = [];
  let durationSec = 0;
  const used = new Set<string>();

  while (durationSec < targetSec * 0.9 && selected.length < 24) {
    const progress = clamp(durationSec / targetSec);
    const desiredEnergy = targetEnergyAt(progress, request);
    const next = candidates
      .filter(({ track }) => !used.has(track.id))
      .sort((a, b) => {
        const aScore = a.fit - Math.abs(a.track.energy - desiredEnergy);
        const bScore = b.fit - Math.abs(b.track.energy - desiredEnergy);
        return bScore - aScore;
      })[0];
    if (!next) break;
    used.add(next.track.id);
    selected.push(next);
    durationSec += durationForTrack(next.track, request.transitionSpeed) - (selected.length > 1 ? 14 : 0);
  }

  const plannedTracks: PlannedTrack[] = [];
  let currentStart = 0;
  selected.forEach((candidate, index) => {
    const playSec = durationForTrack(candidate.track, request.transitionSpeed);
    plannedTracks.push({
      track: candidate.track,
      startSec: currentStart,
      playSec,
      targetEnergy: targetEnergyAt(clamp((currentStart + playSec) / targetSec), request),
      trackFit: candidate.fit
    });
    const next = selected[index + 1];
    if (next) {
      const transition = buildTransitionPlan(candidate.track, next.track, request, profiles, model);
      plannedTracks[index].transitionToNext = transition;
      currentStart += playSec - transitionOverlapSec(request.transitionSpeed, candidate.track, next.track);
    }
  });

  return {
    ids: selected.map(({ track }) => track.id),
    plannedTracks,
    durationSec: plannedTracks.length
      ? plannedTracks[plannedTracks.length - 1].startSec + plannedTracks[plannedTracks.length - 1].playSec
      : 0,
    score: 0,
    genreSwitches: selected.reduce((switches, candidate, index) => {
      const previous = selected[index - 1];
      return switches + (previous && previous.track.genre !== candidate.track.genre ? 1 : 0);
    }, 0),
    warnings: plannedTracks.reduce((sum, planned) => sum + (planned.transitionToNext?.warnings.length ?? 0), 0)
  };
}

export function generateSetlist(
  request: SetlistRequest,
  catalog: Track[] = demoCatalog,
  suppliedModel?: TransitionModel
): SetlistPlan {
  const profiles = getProfilesById(request.similarDjs);
  const activeProfiles = profiles.length > 0 ? profiles : [];
  const model = suppliedModel ?? trainTransitionModel(request, catalog);
  const targetSec = request.durationMin * 60;
  const candidates = candidatePool(request, activeProfiles, catalog);
  const beamWidth = request.transitionSpeed === "fast" ? 34 : 28;
  const maxTracks = request.transitionSpeed === "fast" ? 28 : 22;

  let beam: BeamState[] = candidates.slice(0, 20).map((candidate) => {
    const playSec = durationForTrack(candidate.track, request.transitionSpeed);
    return {
      ids: [candidate.track.id],
      plannedTracks: [
        {
          track: candidate.track,
          startSec: 0,
          playSec,
          targetEnergy: targetEnergyAt(playSec / targetSec, request),
          trackFit: candidate.fit
        }
      ],
      durationSec: playSec,
      score: startScore(candidate, request, activeProfiles),
      genreSwitches: 0,
      warnings: 0
    };
  });

  const finished: BeamState[] = [];

  for (let depth = 1; depth < maxTracks; depth += 1) {
    const expanded = beam.flatMap((state) =>
      expandState(state, candidates, request, activeProfiles, model, targetSec)
    );

    if (expanded.length === 0) break;

    expanded.forEach((state) => {
      if (state.durationSec >= targetSec - 120 && state.durationSec <= targetSec + 220) {
        finished.push(state);
      }
    });

    beam = expanded
      .sort((a, b) => {
        const aScore = a.score - durationPenalty(a.durationSec, targetSec) * (a.durationSec > targetSec ? 3 : 1);
        const bScore = b.score - durationPenalty(b.durationSec, targetSec) * (b.durationSec > targetSec ? 3 : 1);
        return bScore - aScore;
      })
      .slice(0, beamWidth);

    if (finished.length > beamWidth * 6 && beam[0]?.durationSec > targetSec * 0.92) {
      break;
    }
  }

  const best =
    finished
      .sort((a, b) => {
        const aScore = a.score - durationPenalty(a.durationSec, targetSec) * 5 - a.warnings * 0.08;
        const bScore = b.score - durationPenalty(b.durationSec, targetSec) * 5 - b.warnings * 0.08;
        return bScore - aScore;
      })[0] ??
    beam.sort((a, b) => {
      const aScore = a.score - durationPenalty(a.durationSec, targetSec) * 4;
      const bScore = b.score - durationPenalty(b.durationSec, targetSec) * 4;
      return bScore - aScore;
    })[0] ??
    fallbackState(candidates, request, activeProfiles, model);

  return finalizeState(best, request, targetSec);
}

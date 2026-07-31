import type {
  DjProfile,
  Genre,
  HarmonicPolicy,
  SetlistRequest,
  Track,
  TransitionFeatures,
  TransitionModel,
  TransitionSpeed
} from "../types";
import { camelotCompatibility, describeCamelotMove } from "./camelot";
import { catalogById, demoCatalog } from "./demoCatalog";
import { djProfiles, getProfilesById } from "./djProfiles";
import { clamp, mean, seededNoise, sigmoid, weightedAverage } from "./math";

const GENRE_AFFINITY: Record<Genre, Partial<Record<Genre, number>>> = {
  "minimal deep house": {
    "deep house": 0.82,
    "tech house": 0.78,
    house: 0.67,
    "melodic house": 0.55,
    "afro house": 0.48
  },
  "deep house": {
    "minimal deep house": 0.82,
    house: 0.76,
    "afro house": 0.68,
    "melodic house": 0.66,
    "tech house": 0.58
  },
  "tech house": {
    "minimal deep house": 0.78,
    house: 0.73,
    "bass house": 0.68,
    "uk garage": 0.54,
    "melodic house": 0.42
  },
  "melodic house": {
    "progressive house": 0.84,
    "deep house": 0.66,
    "afro house": 0.58,
    house: 0.48,
    trance: 0.54
  },
  "afro house": {
    "deep house": 0.68,
    "melodic house": 0.58,
    house: 0.56,
    "minimal deep house": 0.48,
    "progressive house": 0.48
  },
  "progressive house": {
    "melodic house": 0.84,
    trance: 0.7,
    "deep house": 0.48,
    house: 0.44
  },
  house: {
    "tech house": 0.73,
    "deep house": 0.76,
    "minimal deep house": 0.67,
    "bass house": 0.6,
    "uk garage": 0.58,
    "afro house": 0.56
  },
  "bass house": {
    "tech house": 0.68,
    house: 0.6,
    "uk garage": 0.5,
    trance: 0.34
  },
  "uk garage": {
    house: 0.58,
    "tech house": 0.54,
    "bass house": 0.5,
    trance: 0.34
  },
  trance: {
    "progressive house": 0.7,
    "melodic house": 0.54,
    "bass house": 0.34,
    "uk garage": 0.34
  }
};

const FEATURE_PRIORS: TransitionModel["weights"] = {
  harmonic: 1.28,
  tempo: 1.05,
  energy: 0.9,
  phrase: 0.74,
  texture: 0.72,
  waveform: 0.55,
  genre: 0.88,
  style: 0.8
};

export function genreAffinity(from: Genre, to: Genre): number {
  if (from === to) return 1;
  return GENRE_AFFINITY[from][to] ?? GENRE_AFFINITY[to][from] ?? 0.22;
}

export function durationForTrack(track: Track, speed: TransitionSpeed): number {
  const hookBonus = track.vocal > 0.42 || track.popularity > 0.78 ? 18 : 0;
  if (speed === "fast") {
    return clamp(track.durationSec * 0.52 + hookBonus, 145, 220);
  }
  if (speed === "long blends") {
    return clamp(track.durationSec * 0.74 + hookBonus, 235, 335);
  }
  return clamp(track.durationSec * 0.64 + hookBonus, 185, 280);
}

export function transitionBeats(speed: TransitionSpeed, from?: Track, to?: Track): number {
  const sharedPhraseBeats = from && to ? Math.min(from.outroBars, to.introBars) * 4 : 64;
  if (speed === "fast") return Math.min(sharedPhraseBeats, sharedPhraseBeats >= 32 ? 32 : 16);
  if (speed === "long blends") return Math.min(sharedPhraseBeats, sharedPhraseBeats >= 64 ? 64 : 48);
  return Math.min(sharedPhraseBeats, sharedPhraseBeats >= 48 ? 48 : 32);
}

export function transitionOverlapSec(speed: TransitionSpeed, from: Track, to: Track): number {
  const beats = transitionBeats(speed, from, to);
  const blendBpm = (from.bpm + to.bpm) / 2;
  return (beats / blendBpm) * 60;
}

export function targetEnergyAt(progress: number, request: SetlistRequest): number {
  const crowdLift =
    request.crowdContext === "frat party" || request.crowdContext === "festival"
      ? 0.08
      : request.crowdContext === "warmup" || request.crowdContext === "sunset"
        ? -0.05
        : 0;

  const arc =
    request.energyArc === "steady climb"
      ? 0.46 + 0.34 * progress
      : request.energyArc === "late peak"
        ? 0.48 + 0.42 * Math.pow(progress, 1.55)
        : request.energyArc === "waves"
          ? 0.58 + 0.18 * progress + 0.09 * Math.sin(progress * Math.PI * 4.5)
          : request.energyArc === "warmup"
            ? 0.38 + 0.24 * progress
            : 0.72 + 0.13 * Math.sin(progress * Math.PI);

  return clamp(arc + crowdLift, 0.28, 0.94);
}

function rangeScore(value: number, [min, max]: [number, number], tolerance: number): number {
  if (value >= min && value <= max) return 1;
  const distance = value < min ? min - value : value - max;
  return Math.exp(-Math.pow(distance / tolerance, 2));
}

export function profileSimilarity(track: Track, profiles: DjProfile[]): number {
  if (profiles.length === 0) return 0.5;

  return mean(
    profiles.map((profile) => {
      const genreScore = profile.genres.includes(track.genre)
        ? 1
        : Math.max(...profile.genres.map((genre) => genreAffinity(genre, track.genre)));
      const bpmScore = rangeScore(track.bpm, profile.bpmRange, 3);
      const energyScore = rangeScore(track.energy, profile.energyPreference, 0.18);
      const profileTags = new Set(profile.tags);
      const tagScore =
        track.tags.filter((tag) => profileTags.has(tag)).length / Math.max(3, profile.tags.length);
      return clamp(
        weightedAverage([
          [genreScore, 1.1],
          [bpmScore, 0.8],
          [energyScore, 0.8],
          [tagScore, 1.2]
        ])
      );
    })
  );
}

function promptTagScore(track: Track, request: SetlistRequest): number {
  const prompt = request.prompt.toLowerCase();
  const hits = track.tags.filter((tag) => prompt.includes(tag.toLowerCase())).length;
  const wordHits = track.tags.filter((tag) =>
    tag
      .split(/\s+/)
      .filter((word) => word.length > 4)
      .some((word) => prompt.includes(word))
  ).length;
  return clamp((hits * 0.24 + wordHits * 0.1) / 0.7);
}

function crowdScore(track: Track, request: SetlistRequest): number {
  if (request.crowdContext === "frat party") {
    return weightedAverage([
      [track.energy, 1.2],
      [track.popularity, 1.15],
      [track.vocal, 0.55],
      [track.bassWeight, 0.75],
      [track.tags.includes("frat party") ? 1 : 0.4, 0.8]
    ]);
  }
  if (request.crowdContext === "afterhours" || request.crowdContext === "warehouse") {
    return weightedAverage([
      [1 - Math.abs(track.vocal - 0.12), 0.5],
      [track.groove, 1],
      [track.bassWeight, 0.8],
      [track.density, 0.6],
      [track.tags.includes("afterhours") || track.tags.includes("warehouse") ? 1 : 0.42, 0.8]
    ]);
  }
  if (request.crowdContext === "sunset" || request.crowdContext === "warmup") {
    return weightedAverage([
      [1 - track.density * 0.55, 0.6],
      [track.groove, 0.7],
      [1 - Math.abs(track.energy - 0.52), 0.9],
      [track.tags.includes("sunset") || track.tags.includes("warmup") ? 1 : 0.45, 0.85]
    ]);
  }
  return weightedAverage([
    [track.energy, 0.7],
    [track.danceability, 1],
    [track.popularity, 0.65],
    [track.groove, 0.8]
  ]);
}

function genreFit(track: Track, request: SetlistRequest): number {
  if (request.genres.includes(track.genre)) return 1;
  const closest = Math.max(...request.genres.map((genre) => genreAffinity(genre, track.genre)));
  return request.allowGenreChanges ? closest : closest * 0.35;
}

function speedFit(track: Track, speed: TransitionSpeed): number {
  if (speed === "fast") {
    const cueScore = track.introBars >= 16 && track.outroBars >= 16 ? 1 : 0.58;
    const lengthScore = track.durationSec < 345 ? 1 : 0.76;
    return weightedAverage([
      [cueScore, 1],
      [lengthScore, 0.8],
      [track.density, 0.5],
      [track.dropCount >= 2 ? 1 : 0.6, 0.7]
    ]);
  }
  if (speed === "long blends") {
    return weightedAverage([
      [clamp(Math.min(track.introBars, track.outroBars) / 64), 1.2],
      [1 - track.vocal * 0.28, 0.55],
      [track.groove, 0.8]
    ]);
  }
  return weightedAverage([
    [clamp(Math.min(track.introBars, track.outroBars) / 32), 0.8],
    [track.groove, 0.8],
    [track.danceability, 0.7]
  ]);
}

export function trackFit(track: Track, request: SetlistRequest, profiles: DjProfile[]): number {
  return clamp(
    weightedAverage([
      [genreFit(track, request), 1.5],
      [profileSimilarity(track, profiles), 1.2],
      [crowdScore(track, request), 1.1],
      [speedFit(track, request.transitionSpeed), 0.75],
      [promptTagScore(track, request), 0.4],
      [track.danceability, 0.65]
    ])
  );
}

function tempoCompatibility(from: Track, to: Track, policy: HarmonicPolicy, request: SetlistRequest): number {
  const incomingPitchPct = ((from.bpm - to.bpm) / to.bpm) * 100;
  const max = request.maxTempoShiftPct + (policy === "adventurous" ? 2 : 0);
  if (Math.abs(incomingPitchPct) <= max) {
    return Math.exp(-Math.pow(Math.abs(incomingPitchPct) / Math.max(max, 1), 2) * 0.55);
  }
  return Math.exp(-Math.pow((Math.abs(incomingPitchPct) - max) / 4, 2)) * 0.45;
}

function phraseCompatibility(from: Track, to: Track, speed: TransitionSpeed): number {
  const sharedBars = Math.min(from.outroBars, to.introBars);
  const preferredBars = speed === "fast" ? 8 : speed === "long blends" ? 16 : 12;
  const capacityScore = clamp(sharedBars / preferredBars);
  const breakPenalty = to.breakBars > 32 && speed === "fast" ? 0.18 : 0;
  return clamp(capacityScore - breakPenalty);
}

function textureCompatibility(from: Track, to: Track, request: SetlistRequest): number {
  const vocalPenalty = from.vocal > 0.42 && to.vocal > 0.42 ? 0.22 : 0;
  const bassPenalty = from.bassWeight > 0.84 && to.bassWeight > 0.84 ? 0.08 : 0;
  const densityDistance = Math.abs(from.density - to.density);
  const percussionDistance = Math.abs(from.percussion - to.percussion);
  const brightnessDistance = Math.abs(from.brightness - to.brightness);
  const contrastBonus =
    request.transitionSpeed === "fast" && to.energy > from.energy && to.bassWeight > from.bassWeight
      ? 0.08
      : 0;
  return clamp(
    1 -
      densityDistance * 0.5 -
      percussionDistance * 0.25 -
      brightnessDistance * 0.22 -
      vocalPenalty -
      bassPenalty +
      contrastBonus
  );
}

function waveformCompatibility(from: Track, to: Track): number {
  const tail = from.waveform.slice(-8);
  const head = to.waveform.slice(0, 8);
  const outgoingSlope = tail[0] - tail[tail.length - 1];
  const incomingSlope = head[head.length - 1] - head[0];
  const summedEnergy = tail.map((value, index) => value + head[index]);
  const overlapSmoothness = 1 - mean(summedEnergy.map((value) => Math.abs(value - 1.15)));
  const slopeComplement = clamp((outgoingSlope + incomingSlope + 0.3) / 0.7);
  return clamp(weightedAverage([[overlapSmoothness, 1], [slopeComplement, 0.65]]));
}

function energyCompatibility(from: Track, to: Track, request: SetlistRequest): number {
  const delta = to.energy - from.energy;
  if (request.crowdContext === "frat party" || request.energyArc === "peak-time") {
    const climb = delta >= -0.12 && delta <= 0.22 ? 1 : 0.7 - Math.abs(delta) * 0.8;
    return clamp(climb + (delta > 0.02 ? 0.06 : 0));
  }
  if (request.energyArc === "waves") {
    return clamp(0.95 - Math.max(0, Math.abs(delta) - 0.22));
  }
  return clamp(1 - Math.max(0, Math.abs(delta) - 0.14) * 1.7);
}

function transitionStyleScore(from: Track, to: Track, profiles: DjProfile[]): number {
  if (profiles.length === 0) return 0.5;
  const pairTags = new Set([...from.tags, ...to.tags]);
  return mean(
    profiles.map((profile) => {
      const profileTags = new Set(profile.tags);
      const tagOverlap = [...pairTags].filter((tag) => profileTags.has(tag)).length / Math.max(3, profile.tags.length);
      const range = [
        Math.min(profile.energyPreference[0], from.energy),
        Math.max(profile.energyPreference[1], to.energy)
      ] as [number, number];
      const bpmProgression = rangeScore(from.bpm, profile.bpmRange, 4) * rangeScore(to.bpm, profile.bpmRange, 4);
      const energyProgression = rangeScore(to.energy, range, 0.18);
      return clamp(
        weightedAverage([
          [tagOverlap, 1.1],
          [bpmProgression, 0.75],
          [energyProgression, 0.65],
          [genreAffinity(from.genre, to.genre), 0.45]
        ])
      );
    })
  );
}

export function transitionFeatures(
  from: Track,
  to: Track,
  request: SetlistRequest,
  profiles: DjProfile[]
): TransitionFeatures {
  return {
    harmonic: camelotCompatibility(from.camelot, to.camelot),
    tempo: tempoCompatibility(from, to, request.harmonicPolicy, request),
    energy: energyCompatibility(from, to, request),
    phrase: phraseCompatibility(from, to, request.transitionSpeed),
    texture: textureCompatibility(from, to, request),
    waveform: waveformCompatibility(from, to),
    genre: genreAffinity(from.genre, to.genre),
    style: transitionStyleScore(from, to, profiles)
  };
}

export function scoreTransitionFeatures(features: TransitionFeatures, model: TransitionModel): number {
  const logit =
    model.bias +
    (Object.keys(features) as Array<keyof TransitionFeatures>).reduce((sum, key) => {
      return sum + model.weights[key] * (features[key] - 0.5);
    }, 0);
  return sigmoid(logit);
}

function makeNegativePair(
  fromId: string,
  index: number,
  catalog: Track[],
  usedPositiveTargets: Set<string>
): [string, string] {
  const from = catalog.find((track) => track.id === fromId) ?? catalog[0];
  const candidates = catalog.filter((track) => {
    if (track.id === from.id || usedPositiveTargets.has(track.id)) return false;
    const badKey = camelotCompatibility(from.camelot, track.camelot) < 0.45;
    const badTempo = Math.abs(((from.bpm - track.bpm) / track.bpm) * 100) > 5;
    const badGenre = genreAffinity(from.genre, track.genre) < 0.55;
    return badKey || badTempo || badGenre;
  });
  const pool = candidates.length > 0 ? candidates : catalog.filter((track) => track.id !== from.id);
  const selected = pool[Math.floor(seededNoise(fromId, index) * pool.length) % pool.length];
  return [from.id, selected.id];
}

export function trainTransitionModel(
  request: SetlistRequest,
  catalog: Track[] = demoCatalog
): TransitionModel {
  const selectedProfiles = getProfilesById(request.similarDjs);
  const activeProfiles = selectedProfiles.length > 0 ? selectedProfiles : djProfiles.slice(0, 3);
  const byId = catalogById();

  const examples: Array<{ label: 0 | 1; features: TransitionFeatures }> = [];
  const positivePairs: Array<[string, string]> = [];

  activeProfiles.forEach((profile) => {
    profile.referenceSetlists.forEach((setlist) => {
      for (let index = 0; index < setlist.length - 1; index += 1) {
        const from = byId.get(setlist[index]);
        const to = byId.get(setlist[index + 1]);
        if (from && to) {
          positivePairs.push([from.id, to.id]);
          examples.push({
            label: 1,
            features: transitionFeatures(from, to, request, activeProfiles)
          });
        }
      }
    });
  });

  positivePairs.forEach(([fromId], index) => {
    const positiveTargets = new Set(positivePairs.filter(([id]) => id === fromId).map(([, toId]) => toId));
    const [negativeFromId, negativeToId] = makeNegativePair(fromId, index, catalog, positiveTargets);
    const from = byId.get(negativeFromId);
    const to = byId.get(negativeToId);
    if (from && to) {
      examples.push({
        label: 0,
        features: transitionFeatures(from, to, request, activeProfiles)
      });
    }
  });

  const weights = { ...FEATURE_PRIORS };
  let bias = -0.2;
  const keys = Object.keys(weights) as Array<keyof TransitionFeatures>;
  const learningRate = 0.16;
  const l2 = 0.004;

  for (let epoch = 0; epoch < 180; epoch += 1) {
    const gradients = Object.fromEntries(keys.map((key) => [key, 0])) as Record<keyof TransitionFeatures, number>;
    let biasGradient = 0;

    examples.forEach((example) => {
      const prediction = scoreTransitionFeatures(example.features, {
        weights,
        bias,
        trainingPairs: examples.length,
        selectedProfiles: activeProfiles.map((profile) => profile.id)
      });
      const error = prediction - example.label;
      keys.forEach((key) => {
        gradients[key] += error * (example.features[key] - 0.5);
      });
      biasGradient += error;
    });

    keys.forEach((key) => {
      weights[key] -= learningRate * (gradients[key] / examples.length + l2 * weights[key]);
    });
    bias -= learningRate * (biasGradient / examples.length);
  }

  return {
    weights,
    bias,
    trainingPairs: examples.length,
    selectedProfiles: activeProfiles.map((profile) => profile.id)
  };
}

export function transitionPitchPct(from: Track, to: Track): number {
  return ((from.bpm - to.bpm) / to.bpm) * 100;
}

export function transitionWarnings(
  from: Track,
  to: Track,
  request: SetlistRequest,
  features: TransitionFeatures
): string[] {
  const warnings: string[] = [];
  const pitch = Math.abs(transitionPitchPct(from, to));
  if (pitch > request.maxTempoShiftPct) warnings.push(`tempo stretch ${pitch.toFixed(1)}%`);
  if (request.harmonicPolicy === "strict" && features.harmonic < 0.84) warnings.push("outside strict Camelot rules");
  if (from.vocal > 0.42 && to.vocal > 0.42) warnings.push("watch vocal overlap");
  if (from.bassWeight > 0.86 && to.bassWeight > 0.86) warnings.push("stacked low-end");
  return warnings;
}

export function transitionReasons(features: TransitionFeatures, from: Track, to: Track): string[] {
  const sorted = (Object.entries(features) as Array<[keyof TransitionFeatures, number]>)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key]) => key);
  return sorted.map((feature) => {
    if (feature === "harmonic") return describeCamelotMove(from.camelot, to.camelot);
    if (feature === "tempo") return `${Math.abs(transitionPitchPct(from, to)).toFixed(1)}% BPM adjustment`;
    if (feature === "phrase") return "phrase-ready intro/outro";
    if (feature === "texture") return "compatible drum and vocal density";
    if (feature === "waveform") return "outro and intro energy interlock";
    if (feature === "genre") return from.genre === to.genre ? "same genre lane" : "adjacent genre lane";
    if (feature === "style") return "matches selected DJ references";
    return "energy move supports the arc";
  });
}

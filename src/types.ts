export type Genre =
  | "minimal deep house"
  | "deep house"
  | "tech house"
  | "melodic house"
  | "afro house"
  | "progressive house"
  | "house"
  | "bass house"
  | "uk garage"
  | "trance";

export type CrowdContext =
  | "frat party"
  | "club"
  | "afterhours"
  | "festival"
  | "sunset"
  | "warmup"
  | "warehouse";

export type TransitionSpeed = "fast" | "balanced" | "long blends";
export type EnergyArc = "steady climb" | "waves" | "late peak" | "warmup" | "peak-time";
export type HarmonicPolicy = "strict" | "guided" | "adventurous";

export type CamelotMode = "A" | "B";
export type CamelotKey = `${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}${CamelotMode}`;

export interface Track {
  id: string;
  title: string;
  artist: string;
  genre: Genre;
  bpm: number;
  camelot: CamelotKey;
  durationSec: number;
  energy: number;
  danceability: number;
  popularity: number;
  groove: number;
  vocal: number;
  bassWeight: number;
  percussion: number;
  brightness: number;
  density: number;
  introBars: number;
  outroBars: number;
  breakBars: number;
  dropCount: number;
  tags: string[];
  waveform: number[];
  soundcloudId?: string;
  soundcloudUrl?: string;
}

export interface DjProfile {
  id: string;
  name: string;
  genres: Genre[];
  bpmRange: [number, number];
  energyPreference: [number, number];
  transitionSpeed: TransitionSpeed;
  harmonicPolicy: HarmonicPolicy;
  tags: string[];
  referenceSetlists: string[][];
  setNotes: string;
}

export interface SetlistRequest {
  prompt: string;
  genres: Genre[];
  similarDjs: string[];
  durationMin: number;
  transitionSpeed: TransitionSpeed;
  harmonicPolicy: HarmonicPolicy;
  allowGenreChanges: boolean;
  energyArc: EnergyArc;
  crowdContext: CrowdContext;
  maxTempoShiftPct: number;
}

export interface TransitionFeatures {
  harmonic: number;
  tempo: number;
  energy: number;
  phrase: number;
  texture: number;
  waveform: number;
  genre: number;
  style: number;
}

export interface TransitionPlan {
  fromId: string;
  toId: string;
  score: number;
  confidence: number;
  harmonicMove: string;
  incomingPitchPct: number;
  phraseBeats: number;
  recipe: string;
  reasons: string[];
  warnings: string[];
  features: TransitionFeatures;
}

export interface PlannedTrack {
  track: Track;
  startSec: number;
  playSec: number;
  targetEnergy: number;
  trackFit: number;
  transitionToNext?: TransitionPlan;
}

export interface SetlistPlan {
  request: SetlistRequest;
  tracks: PlannedTrack[];
  totalDurationSec: number;
  score: number;
  confidence: number;
  summary: string;
  optimizerNotes: string[];
}

export interface TransitionModel {
  weights: Record<keyof TransitionFeatures, number>;
  bias: number;
  trainingPairs: number;
  selectedProfiles: string[];
}

export interface SoundCloudPlaylistPayload {
  title: string;
  description: string;
  trackIds: string[];
  sharing: "public" | "private";
}

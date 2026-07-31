import type {
  CrowdContext,
  EnergyArc,
  Genre,
  HarmonicPolicy,
  SetlistRequest,
  TransitionSpeed
} from "../types";
import { djProfiles } from "./djProfiles";

const GENRE_ALIASES: Array<[Genre, RegExp]> = [
  ["minimal deep house", /\b(minimal\s+deep|minimal\s+house|microhouse|rominimal)\b/i],
  ["deep house", /\bdeep\s+house\b/i],
  ["tech house", /\btech\s+house\b/i],
  ["melodic house", /\bmelodic\s+house\b/i],
  ["afro house", /\bafro\s+house\b/i],
  ["progressive house", /\bprogressive\s+house\b/i],
  ["bass house", /\bbass\s+house\b/i],
  ["uk garage", /\b(ukg|uk\s+garage|garage)\b/i],
  ["trance", /\btrance\b/i],
  ["house", /\bhouse\b/i]
];

const CROWD_ALIASES: Array<[CrowdContext, RegExp]> = [
  ["frat party", /\b(frat|college|red cup|house party|party)\b/i],
  ["festival", /\b(festival|main stage|outdoor stage)\b/i],
  ["afterhours", /\b(afterhours|late night|sunrise)\b/i],
  ["sunset", /\b(sunset|beach|pool|patio|day party)\b/i],
  ["warmup", /\b(warmup|opening|opener|early)\b/i],
  ["warehouse", /\b(warehouse|rave|underground)\b/i],
  ["club", /\b(club|main room|dancefloor)\b/i]
];

export const defaultRequest: SetlistRequest = {
  prompt:
    "I want to create a minimal deep house/tech house setlist that is about an hour long and has pretty fast transitions for a frat party.",
  genres: ["minimal deep house", "tech house"],
  similarDjs: ["chris-stussy", "pawsa", "michael-bibi"],
  durationMin: 60,
  transitionSpeed: "fast",
  harmonicPolicy: "guided",
  allowGenreChanges: true,
  energyArc: "late peak",
  crowdContext: "frat party",
  maxTempoShiftPct: 6
};

function uniqueGenres(genres: Genre[]): Genre[] {
  return genres.filter((genre, index) => genres.indexOf(genre) === index);
}

function parseDuration(prompt: string): number | undefined {
  const lower = prompt.toLowerCase();
  const hourMatch = lower.match(/\b(?:about|around|roughly|approx(?:imately)?)?\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (hourMatch) return Math.round(Number.parseFloat(hourMatch[1]) * 60);

  if (/\b(an|one|1)\s+hour\b/.test(lower)) return 60;
  if (/\bhalf\s+hour\b/.test(lower)) return 30;
  if (/\b90\s*(?:min|minutes?)\b/.test(lower)) return 90;

  const minuteMatch = lower.match(/\b(\d{2,3})\s*(?:min|mins|minutes?)\b/);
  if (minuteMatch) return Number.parseInt(minuteMatch[1], 10);

  return undefined;
}

function parseTransitionSpeed(prompt: string): TransitionSpeed | undefined {
  if (/\b(fast|quick|rapid|slam|short|pretty fast)\b/i.test(prompt)) return "fast";
  if (/\b(long blend|long transitions|smooth blends|patient|extended)\b/i.test(prompt)) return "long blends";
  if (/\bbalanced|medium|normal\b/i.test(prompt)) return "balanced";
  return undefined;
}

function parseHarmonicPolicy(prompt: string): HarmonicPolicy | undefined {
  if (/\b(strict|only|always)\b.*\b(key|camelot|harmonic|mixed in key)\b/i.test(prompt)) return "strict";
  if (/\b(camelot|mixed in key|harmonic|in key)\b/i.test(prompt)) return "guided";
  if (/\b(key clashes|adventurous|surprising|wild|ignore key|not in key)\b/i.test(prompt)) return "adventurous";
  return undefined;
}

function parseEnergyArc(prompt: string): EnergyArc | undefined {
  if (/\b(waves|wavey|peaks and valleys|ebb)\b/i.test(prompt)) return "waves";
  if (/\b(late peak|build to peak|big finish|finale|climax)\b/i.test(prompt)) return "late peak";
  if (/\b(warmup|opening|opener|early)\b/i.test(prompt)) return "warmup";
  if (/\b(peak time|peak-time|high energy|rage|banger)\b/i.test(prompt)) return "peak-time";
  if (/\b(steady climb|build|ramp)\b/i.test(prompt)) return "steady climb";
  return undefined;
}

function parseGenreChanges(prompt: string): boolean | undefined {
  if (/\b(no|without|avoid)\b.*\b(genre changes|genre shifts|switching genres)\b/i.test(prompt)) return false;
  if (/\b(genre changes|genre shifts|switch genres|switch it up|change genres)\b/i.test(prompt)) return true;
  return undefined;
}

function parseCrowd(prompt: string): CrowdContext | undefined {
  const match = CROWD_ALIASES.find(([, pattern]) => pattern.test(prompt));
  return match?.[0];
}

function parseGenres(prompt: string): Genre[] {
  const lower = prompt.toLowerCase();
  const matches = GENRE_ALIASES.filter(([, pattern]) => pattern.test(lower)).map(([genre]) => genre);

  if (matches.includes("minimal deep house")) {
    return uniqueGenres(matches.filter((genre) => genre !== "house"));
  }

  return uniqueGenres(matches);
}

function parseDjs(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  return djProfiles
    .filter((profile) => {
      const normalized = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const compact = normalized.replace(/\s+/g, "");
      return lower.includes(normalized) || lower.replace(/[^a-z0-9]+/g, "").includes(compact);
    })
    .map((profile) => profile.id);
}

export function inferRequest(prompt: string, previous: SetlistRequest = defaultRequest): SetlistRequest {
  const genres = parseGenres(prompt);
  const djs = parseDjs(prompt);
  const crowd = parseCrowd(prompt);
  const transitionSpeed = parseTransitionSpeed(prompt);
  const harmonicPolicy = parseHarmonicPolicy(prompt);
  const energyArc = parseEnergyArc(prompt);
  const allowGenreChanges = parseGenreChanges(prompt);
  const durationMin = parseDuration(prompt);

  const inferredCrowd = crowd ?? previous.crowdContext;
  const inferredSpeed = transitionSpeed ?? previous.transitionSpeed;

  return {
    ...previous,
    prompt,
    genres: genres.length > 0 ? genres : previous.genres,
    similarDjs: djs.length > 0 ? djs : previous.similarDjs,
    durationMin: durationMin ?? previous.durationMin,
    transitionSpeed: inferredSpeed,
    harmonicPolicy: harmonicPolicy ?? previous.harmonicPolicy,
    allowGenreChanges: allowGenreChanges ?? previous.allowGenreChanges,
    energyArc:
      energyArc ??
      (inferredCrowd === "frat party" && inferredSpeed === "fast" ? "late peak" : previous.energyArc),
    crowdContext: inferredCrowd,
    maxTempoShiftPct:
      inferredSpeed === "fast"
        ? 8
        : inferredSpeed === "long blends"
          ? 5
          : previous.maxTempoShiftPct
  };
}

export function requestDisplayText(request: SetlistRequest): string {
  const genres = request.genres.join(" + ");
  const djs =
    request.similarDjs
      .map((id) => djProfiles.find((profile) => profile.id === id)?.name)
      .filter(Boolean)
      .join(", ") || "custom";
  return `${request.durationMin} min ${genres} set, ${request.transitionSpeed}, ${request.harmonicPolicy} harmonic policy, similar to ${djs}`;
}

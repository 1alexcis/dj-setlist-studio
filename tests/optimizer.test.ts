import { describe, expect, it } from "vitest";
import { camelotCompatibility, isStrictCamelotCompatible } from "../src/lib/camelot";
import { demoCatalog } from "../src/lib/demoCatalog";
import { scoreTransitionFeatures, trainTransitionModel, transitionFeatures } from "../src/lib/features";
import { generateSetlist } from "../src/lib/optimizer";
import { defaultRequest, inferRequest } from "../src/lib/prompt";
import type { DjProfile } from "../src/types";

describe("Camelot compatibility", () => {
  it("scores common harmonic moves higher than distant key jumps", () => {
    expect(camelotCompatibility("8A", "9A")).toBeGreaterThan(0.9);
    expect(camelotCompatibility("8A", "8B")).toBeGreaterThan(0.9);
    expect(camelotCompatibility("8A", "3B")).toBeLessThan(0.45);
    expect(isStrictCamelotCompatible("8A", "9A")).toBe(true);
    expect(isStrictCamelotCompatible("8A", "3B")).toBe(false);
  });
});

describe("prompt inference", () => {
  it("extracts the requested frat-party tech house brief", () => {
    const request = inferRequest(
      "I want to create a minimal deep house/tech house setlist that is about an hour long and has pretty fast transitions for a frat party"
    );

    expect(request.genres).toContain("minimal deep house");
    expect(request.genres).toContain("tech house");
    expect(request.durationMin).toBe(60);
    expect(request.transitionSpeed).toBe("fast");
    expect(request.crowdContext).toBe("frat party");
    expect(request.energyArc).toBe("late peak");
  });
});

describe("transition model", () => {
  it("learns selected DJ transition patterns over obvious negatives", () => {
    const request = {
      ...defaultRequest,
      similarDjs: ["pawsa"],
      genres: ["tech house" as const],
      harmonicPolicy: "guided" as const
    };
    const model = trainTransitionModel(request);
    const byId = new Map(demoCatalog.map((track) => [track.id, track]));
    const positiveFrom = byId.get("rolling-credit")!;
    const positiveTo = byId.get("roof-access")!;
    const negativeTo = byId.get("halo-return")!;
    const profiles: DjProfile[] = [];

    const positiveScore = scoreTransitionFeatures(
      transitionFeatures(positiveFrom, positiveTo, request, profiles),
      model
    );
    const negativeScore = scoreTransitionFeatures(
      transitionFeatures(positiveFrom, negativeTo, request, profiles),
      model
    );

    expect(positiveScore).toBeGreaterThan(negativeScore);
  });
});

describe("setlist optimizer", () => {
  it("builds a near-hour fast set with unique tracks and transition plans", () => {
    const plan = generateSetlist(defaultRequest);
    expect(plan.tracks.length).toBeGreaterThanOrEqual(15);
    expect(plan.totalDurationSec).toBeGreaterThan(58 * 60);
    expect(plan.totalDurationSec).toBeLessThan(64 * 60);
    expect(new Set(plan.tracks.map((planned) => planned.track.id)).size).toBe(plan.tracks.length);
    expect(plan.tracks.slice(0, -1).every((planned) => planned.transitionToNext)).toBe(true);
  });

  it("honors strict harmonic mode", () => {
    const plan = generateSetlist({
      ...defaultRequest,
      durationMin: 35,
      harmonicPolicy: "strict",
      allowGenreChanges: false
    });

    expect(plan.tracks.length).toBeGreaterThan(7);
    plan.tracks.slice(0, -1).forEach((planned, index) => {
      const next = plan.tracks[index + 1].track;
      expect(isStrictCamelotCompatible(planned.track.camelot, next.camelot)).toBe(true);
    });
  });
});

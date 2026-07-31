import type { CamelotKey } from "../types";

const KEY_TO_CAMELOT: Record<string, CamelotKey> = {
  "A-flat minor": "1A",
  "G-sharp minor": "1A",
  "B major": "1B",
  "E-flat minor": "2A",
  "D-sharp minor": "2A",
  "F-sharp major": "2B",
  "B-flat minor": "3A",
  "A-sharp minor": "3A",
  "D-flat major": "3B",
  "F minor": "4A",
  "A-flat major": "4B",
  "C minor": "5A",
  "E-flat major": "5B",
  "G minor": "6A",
  "B-flat major": "6B",
  "D minor": "7A",
  "F major": "7B",
  "A minor": "8A",
  "C major": "8B",
  "E minor": "9A",
  "G major": "9B",
  "B minor": "10A",
  "D major": "10B",
  "F-sharp minor": "11A",
  "G-flat minor": "11A",
  "A major": "11B",
  "D-flat minor": "12A",
  "C-sharp minor": "12A",
  "E major": "12B"
};

export function parseCamelot(input: string): CamelotKey | undefined {
  const normalized = input.trim().toUpperCase();
  if (/^(1[0-2]|[1-9])[AB]$/.test(normalized)) {
    return normalized as CamelotKey;
  }

  const titleCase = input
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bMajor\b/, "major")
    .replace(/\bMinor\b/, "minor");

  return KEY_TO_CAMELOT[titleCase];
}

export function camelotNumber(key: CamelotKey): number {
  return Number.parseInt(key.slice(0, -1), 10);
}

export function camelotMode(key: CamelotKey): "A" | "B" {
  return key.endsWith("A") ? "A" : "B";
}

function wheelDistance(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 12 - raw);
}

function signedClockwiseDistance(a: number, b: number): number {
  return ((b - a + 12) % 12) || 0;
}

export function describeCamelotMove(from: CamelotKey, to: CamelotKey): string {
  const fromNumber = camelotNumber(from);
  const toNumber = camelotNumber(to);
  const fromMode = camelotMode(from);
  const toMode = camelotMode(to);
  const clockwise = signedClockwiseDistance(fromNumber, toNumber);

  if (from === to) return "same key lock";
  if (fromNumber === toNumber && fromMode !== toMode) return "relative major/minor";
  if (fromMode === toMode && wheelDistance(fromNumber, toNumber) === 1) {
    return clockwise === 1 ? "+1 Camelot neighbor" : "-1 Camelot neighbor";
  }
  if (fromMode === toMode && clockwise === 2) return "+2 energy boost";
  if (fromMode === toMode && clockwise === 7) return "-5 dramatic lift";
  if (fromMode === "B" && toMode === "A" && clockwise === 1) return "diagonal compatible";
  if (fromMode === "A" && toMode === "B" && clockwise === 11) return "diagonal compatible";
  if (fromMode === toMode && wheelDistance(fromNumber, toNumber) <= 2) return "wide harmonic move";
  return "outside Camelot comfort zone";
}

export function camelotCompatibility(from: CamelotKey, to: CamelotKey): number {
  const fromNumber = camelotNumber(from);
  const toNumber = camelotNumber(to);
  const fromMode = camelotMode(from);
  const toMode = camelotMode(to);
  const clockwise = signedClockwiseDistance(fromNumber, toNumber);
  const distance = wheelDistance(fromNumber, toNumber);

  if (from === to) return 1;
  if (fromNumber === toNumber && fromMode !== toMode) return 0.92;
  if (fromMode === toMode && distance === 1) return 0.95;
  if (fromMode === "B" && toMode === "A" && clockwise === 1) return 0.86;
  if (fromMode === "A" && toMode === "B" && clockwise === 11) return 0.84;
  if (fromMode === toMode && clockwise === 2) return 0.76;
  if (fromMode === toMode && clockwise === 7) return 0.7;
  if (fromMode === toMode && distance === 2) return 0.58;
  if (distance <= 3) return 0.42;
  return 0.15;
}

export function isStrictCamelotCompatible(from: CamelotKey, to: CamelotKey): boolean {
  return camelotCompatibility(from, to) >= 0.84;
}

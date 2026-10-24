import { isGurumiCharacterId } from "./characters";
import {
  GURUMI_SCORE_VERSION,
  type SimilarityScore,
} from "./similarity";

export const GURUMI_LEADERBOARD_LIMIT = 1_000;

export type ScoreRecord = {
  id: string;
  name: string;
  score: number;
  calibrated: number;
  raw: number;
  semantic: number;
  global: number;
  densityRatio: number;
  overdrawEfficiency: number;
  orientationEntropy: number;
  loopMonotony: number;
  partScores: Record<string, number>;
  characterId?: string;
  createdAt: string;
  scoreVersion: string;
};

export type ScoreSubmission = {
  id: string;
  name: string;
  roundToken: string;
  strokes: string;
};

export type GurumiRoundSession = {
  characterId: string;
  expiresAt: string;
  id: string;
  token: string;
};

export type PendingScore = {
  id: string;
  record: ScoreRecord;
  submission: ScoreSubmission;
};

export type ScoreSubmissionResponse = {
  leaderboard: ScoreRecord[];
  record: ScoreRecord;
};

export type LeaderboardResponse = {
  leaderboard: ScoreRecord[];
};

export function normalizeGurumiName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const length = Array.from(name).length;
  if (length < 2 || length > 10 || /[\u0000-\u001F\u007F]/.test(name)) return null;
  return name;
}

export function isGurumiRecordId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/.test(value);
}

export function isGurumiRoundSession(value: unknown): value is GurumiRoundSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<GurumiRoundSession>;
  return (
    isGurumiRecordId(session.id) &&
    isGurumiCharacterId(session.characterId) &&
    typeof session.token === "string" &&
    session.token.length > 0 &&
    typeof session.expiresAt === "string" &&
    Number.isFinite(Date.parse(session.expiresAt))
  );
}

export function isPendingScore(value: unknown): value is PendingScore {
  if (!value || typeof value !== "object") return false;
  const pending = value as Partial<PendingScore>;
  return (
    isGurumiRecordId(pending.id) &&
    isScoreRecord(pending.record) &&
    Boolean(pending.submission) &&
    pending.id === pending.record.id &&
    pending.submission?.id === pending.id &&
    typeof pending.submission.name === "string" &&
    typeof pending.submission.roundToken === "string" &&
    pending.submission.roundToken.length > 0 &&
    typeof pending.submission.strokes === "string"
  );
}

export function createScoreRecord({
  id,
  name,
  score,
  createdAt,
  characterId,
}: {
  id: string;
  name: string;
  score: SimilarityScore;
  createdAt: string;
  characterId?: string;
}): ScoreRecord {
  return {
    id,
    name,
    ...(characterId ? { characterId } : {}),
    score: score.score,
    calibrated: score.calibrated,
    raw: score.raw,
    semantic: score.semantic,
    global: score.global,
    densityRatio: score.densityRatio,
    overdrawEfficiency: score.overdrawEfficiency,
    orientationEntropy: score.orientationEntropy,
    loopMonotony: score.loopMonotony,
    partScores: Object.fromEntries(
      Object.entries(score.parts).map(([part, value]) => [part, value.score]),
    ),
    createdAt,
    scoreVersion: characterId ? GURUMI_SCORE_VERSION : "semantic-shape-v3",
  };
}

export function sortRecords(records: ScoreRecord[]) {
  return [...records].sort((first, second) => {
    if (second.score !== first.score) return second.score - first.score;
    if (second.calibrated !== first.calibrated) return second.calibrated - first.calibrated;
    if (second.raw !== first.raw) return second.raw - first.raw;
    return first.createdAt.localeCompare(second.createdAt);
  });
}

export function isScoreRecord(value: unknown): value is ScoreRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ScoreRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.score === "number" &&
    typeof record.calibrated === "number" &&
    typeof record.raw === "number" &&
    typeof record.semantic === "number" &&
    typeof record.global === "number" &&
    typeof record.densityRatio === "number" &&
    typeof record.overdrawEfficiency === "number" &&
    typeof record.orientationEntropy === "number" &&
    typeof record.loopMonotony === "number" &&
    Boolean(record.partScores) &&
    typeof record.partScores === "object" &&
    Object.values(record.partScores ?? {}).length > 0 &&
    Object.values(record.partScores ?? {}).every((part) => typeof part === "number" && Number.isFinite(part)) &&
    (record.characterId === undefined || typeof record.characterId === "string") &&
    typeof record.createdAt === "string" &&
    typeof record.scoreVersion === "string"
  );
}

export function isLeaderboardResponse(value: unknown): value is LeaderboardResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<LeaderboardResponse>;
  return Array.isArray(response.leaderboard) && response.leaderboard.every(isScoreRecord);
}

export function isScoreSubmissionResponse(value: unknown): value is ScoreSubmissionResponse {
  if (!isLeaderboardResponse(value)) return false;
  return isScoreRecord((value as Partial<ScoreSubmissionResponse>).record);
}

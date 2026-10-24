import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getGurumiDatabaseConfig } from "./database-config";
import { GURUMI_LEADERBOARD_LIMIT, isScoreRecord, type ScoreRecord } from "./records";
import { GURUMI_SCORE_VERSION, type SimilarityScore } from "./similarity";

const TABLE_NAME = "gurumi_scores";
const SCORE_COLUMNS = "id,name,score,calibrated,raw,semantic,global_score,density_ratio,overdraw_efficiency,orientation_entropy,loop_monotony,part_scores,created_at,score_version,character_id";
let client: SupabaseClient | null = null;

function getClient() {
  if (!client) {
    const { url, key } = getGurumiDatabaseConfig();
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

function recordFromRow(row: Record<string, unknown>): ScoreRecord {
  const candidate = {
    id: row.id, name: row.name, score: row.score,
    calibrated: row.calibrated, raw: row.raw, semantic: row.semantic,
    global: row.global_score, densityRatio: row.density_ratio,
    overdrawEfficiency: row.overdraw_efficiency, orientationEntropy: row.orientation_entropy,
    loopMonotony: row.loop_monotony, partScores: row.part_scores,
    createdAt: row.created_at, scoreVersion: row.score_version,
    ...(typeof row.character_id === "string" ? { characterId: row.character_id } : {}),
  };
  if (!isScoreRecord(candidate)) throw new Error("Stored Gurumi score has an invalid shape.");
  return candidate;
}

export async function listGurumiScores(limit = GURUMI_LEADERBOARD_LIMIT, { allVersions = false } = {}) {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(GURUMI_LEADERBOARD_LIMIT, Math.max(1, Math.trunc(limit)))
    : GURUMI_LEADERBOARD_LIMIT;
  let query = getClient().from(TABLE_NAME).select(SCORE_COLUMNS);
  if (!allVersions) query = query.eq("score_version", GURUMI_SCORE_VERSION);
  const { data, error } = await query.order("score", { ascending: false }).order("calibrated", { ascending: false })
    .order("raw", { ascending: false }).order("created_at", { ascending: true }).limit(safeLimit);
  if (error) throw error;
  return (data ?? []).map(recordFromRow);
}

export async function findGurumiScore(id: string) {
  const { data, error } = await getClient().from(TABLE_NAME).select(SCORE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? recordFromRow(data) : null;
}

export async function findGurumiDrawing(id: string) {
  const { data, error } = await getClient().from(TABLE_NAME).select("strokes").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { strokes: String(data.strokes) } : null;
}

export async function updateGurumiScore({ id, name, score }: { id: string; name: string; score: number }) {
  const { data, error } = await getClient().from(TABLE_NAME).update({ name, score })
    .eq("id", id).select(SCORE_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? recordFromRow(data) : null;
}

export async function deleteGurumiScore(id: string) {
  const { data, error } = await getClient().from(TABLE_NAME).delete().eq("id", id).select("id");
  if (error) throw error;
  return Boolean(data?.length);
}

export async function saveGurumiScore({ record, scoreDetails, strokes, pointCount }: {
  record: ScoreRecord; scoreDetails: SimilarityScore; strokes: string; pointCount: number;
}) {
  const { error } = await getClient().from(TABLE_NAME).upsert({
    id: record.id, name: record.name, score: record.score,
    calibrated: record.calibrated, raw: record.raw, semantic: record.semantic,
    global_score: record.global, density_ratio: record.densityRatio,
    overdraw_efficiency: record.overdrawEfficiency, orientation_entropy: record.orientationEntropy,
    loop_monotony: record.loopMonotony, part_scores: record.partScores,
    score_details: scoreDetails, strokes, point_count: pointCount,
    created_at: record.createdAt, score_version: record.scoreVersion,
    character_id: record.characterId ?? null,
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
  const storedRecord = await findGurumiScore(record.id);
  if (!storedRecord) throw new Error("Saved Gurumi score could not be loaded.");
  return storedRecord;
}

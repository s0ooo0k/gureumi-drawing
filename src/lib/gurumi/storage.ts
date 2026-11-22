import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getGurumiDatabaseConfig } from "./database-config";
import {
  GURUMI_DEFAULT_GIFT_MIN_SCORE,
  GURUMI_LEADERBOARD_LIMIT,
  GURUMI_TOP_DRAWING_LIMIT,
  isGurumiGiftMinimumScore,
  isScoreRecord,
  type AdminScoreRecord,
  type GurumiAdminData,
  type ScoreRecord,
} from "./records";
import { GURUMI_SCORE_VERSION, type SimilarityScore } from "./similarity";

const TABLE_NAME = "gurumi_scores";
const GIFT_SETTINGS_TABLE = "gurumi_gift_settings";
const SCORE_COLUMNS = "id,name,score,calibrated,raw,semantic,global_score,density_ratio,overdraw_efficiency,orientation_entropy,loop_monotony,part_scores,created_at,score_version,character_id";
const STORED_SCORE_COLUMNS = `${SCORE_COLUMNS},is_visible` as const;
const ADMIN_SCORE_COLUMNS = `${STORED_SCORE_COLUMNS},gift_received` as const;
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
    ...(typeof row.is_visible === "boolean" ? { isVisible: row.is_visible } : {}),
  };
  if (!isScoreRecord(candidate)) throw new Error("Stored Gurumi score has an invalid shape.");
  return candidate;
}

function rankedScoreRows<Columns extends string>(columns: Columns) {
  return getClient().from(TABLE_NAME).select(columns)
    .order("score", { ascending: false })
    .order("calibrated", { ascending: false })
    .order("raw", { ascending: false })
    .order("created_at", { ascending: true });
}

export async function listGurumiScores(limit = GURUMI_LEADERBOARD_LIMIT) {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(GURUMI_LEADERBOARD_LIMIT, Math.max(1, Math.trunc(limit)))
    : GURUMI_LEADERBOARD_LIMIT;
  const { data, error } = await rankedScoreRows(SCORE_COLUMNS)
    .limit(safeLimit)
    .eq("score_version", GURUMI_SCORE_VERSION)
    .eq("is_visible", true);
  if (error) throw error;
  return (data ?? []).map(recordFromRow);
}

async function readGiftMinimumScore({ allowUnmigrated = false } = {}) {
  const { data, error } = await getClient().from(GIFT_SETTINGS_TABLE).select("minimum_score")
    .eq("singleton", true).single();
  if (error) {
    if (allowUnmigrated && (error.code === "42P01" || error.code === "PGRST205")) {
      return GURUMI_DEFAULT_GIFT_MIN_SCORE;
    }
    throw error;
  }
  if (!isGurumiGiftMinimumScore(data.minimum_score)) throw new Error("Invalid Gurumi gift minimum score.");
  return data.minimum_score;
}

export async function listGurumiTopDrawings(limit = GURUMI_TOP_DRAWING_LIMIT) {
  const { data, error } = await rankedScoreRows("id,strokes")
    .eq("score_version", GURUMI_SCORE_VERSION)
    .eq("is_visible", true)
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: String(row.id), strokes: String(row.strokes) }));
}

export async function loadGurumiLeaderboard() {
  const [leaderboard, giftMinimumScore] = await Promise.all([
    listGurumiScores(),
    readGiftMinimumScore({ allowUnmigrated: true }),
  ]);
  return { leaderboard, giftMinimumScore };
}

async function listGurumiAdminScores() {
  const records: AdminScoreRecord[] = [];
  for (;;) {
    const { data, error } = await rankedScoreRows(ADMIN_SCORE_COLUMNS)
      .order("id", { ascending: true })
      .range(records.length, records.length + GURUMI_LEADERBOARD_LIMIT - 1);
    if (error) throw error;

    const page = data ?? [];
    records.push(...page.map((row) => ({
      ...recordFromRow(row),
      giftReceived: row.gift_received === true,
      isVisible: row.is_visible === true,
    })));
    if (page.length < GURUMI_LEADERBOARD_LIMIT) return records;
  }
}

export async function loadGurumiAdminData(): Promise<GurumiAdminData> {
  const [records, giftMinimumScore, receipts] = await Promise.all([
    listGurumiAdminScores(),
    readGiftMinimumScore(),
    getClient().from(TABLE_NAME).select("id", { count: "exact", head: true }).eq("gift_received", true),
  ]);
  if (receipts.error) throw receipts.error;
  if (receipts.count === null) throw new Error("Gurumi gift receipt count is unavailable.");

  return { records, giftMinimumScore, giftReceivedCount: receipts.count };
}

export async function updateGurumiGiftMinimumScore(minimumScore: number) {
  const { error } = await getClient().from(GIFT_SETTINGS_TABLE).update({ minimum_score: minimumScore })
    .eq("singleton", true).select("minimum_score").single();
  if (error) throw error;
}

export async function updateGurumiGiftReceived(id: string, giftReceived: boolean) {
  const { data, error } = await getClient().from(TABLE_NAME).update({ gift_received: giftReceived })
    .eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function updateGurumiScoreVisibility(ids: string[], isVisible: boolean) {
  const { data, error } = await getClient().from(TABLE_NAME).update({ is_visible: isVisible })
    .in("id", ids).select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

export async function findGurumiScore(id: string) {
  const { data, error } = await getClient().from(TABLE_NAME).select(STORED_SCORE_COLUMNS).eq("id", id).maybeSingle();
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

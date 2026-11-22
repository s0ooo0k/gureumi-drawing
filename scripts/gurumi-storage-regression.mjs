import assert from "node:assert/strict";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import ts from "typescript";

function compile(file, imports = {}) {
  const javascript = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const box = { exports: {} };
  new Function("exports", "module", "require", javascript)(box.exports, box, (id) => {
    assert.ok(id in imports, `Unexpected import: ${id}`);
    return imports[id];
  });
  return box.exports;
}
const similarity = compile("src/lib/gurumi/similarity.ts");
const characters = compile("src/lib/gurumi/characters.ts");
const records = compile("src/lib/gurumi/records.ts", { "./similarity": similarity, "./characters": characters });
const zeroScore = similarity.scoreDrawing([], {});
const record = records.createScoreRecord({ id: "test-record", name: "테스트", score: zeroScore, characterId: "devops", createdAt: "2026-10-19T12:00:00+00:00" });
const fixture = { id: record.id, name: record.name, created_at: record.createdAt, character_id: record.characterId };
Object.assign(fixture, {
  score: record.score, calibrated: record.calibrated, raw: record.raw,
  semantic: record.semantic, global_score: record.global, density_ratio: record.densityRatio,
  overdraw_efficiency: record.overdrawEfficiency, orientation_entropy: record.orientationEntropy,
  loop_monotony: record.loopMonotony, part_scores: record.partScores, score_version: record.scoreVersion,
});
let responseData = [fixture];
let fail = false;
let giftMode = false;
let settingsMissing = false;
let pagedRecords = false;
let giftMinimumScore = 60;
let giftReceived = false;
let isVisible = true;
const requests = [];
const storage = compile("src/lib/gurumi/storage.ts", {
  "server-only": {}, "./records": records, "./similarity": similarity,
  "./database-config": { getGurumiDatabaseConfig: () => ({ url: "https://test.supabase.co", key: "server-secret" }) },
  "@supabase/supabase-js": { createClient: (url, key, options) => createClient(url, key, {
    ...options, global: { fetch: async (url, init) => {
      const request = { url: new URL(url), ...init };
      requests.push(request);
      if (giftMode) {
        const json = (body, status = 200) => new Response(JSON.stringify(body), {
          status, headers: { "Content-Type": "application/json" },
        });
        if (request.url.pathname.endsWith("/gurumi_gift_settings")) {
          if (settingsMissing) return json({ code: "PGRST205", message: "table missing" }, 404);
          if (init.method === "PATCH") giftMinimumScore = JSON.parse(init.body).minimum_score;
          return json({ minimum_score: giftMinimumScore });
        }
        if (init.method === "HEAD") {
          return new Response(null, { headers: { "Content-Range": `*/${Number(giftReceived)}` } });
        }
        if (init.method === "PATCH") {
          const idFilter = request.url.searchParams.get("id");
          if (idFilter === "eq.missing") return json(null);
          const update = JSON.parse(init.body);
          if ("is_visible" in update) {
            if (idFilter !== "in.(test-record)") return json([]);
            isVisible = update.is_visible;
            return json([{ id: record.id }]);
          }
          giftReceived = update.gift_received;
          return json({ id: record.id });
        }
        const isAdminList = request.url.searchParams.get("select").includes("gift_received");
        if (isAdminList && pagedRecords && request.url.searchParams.get("offset") === "0") {
          return json(Array.from({ length: 1_000 }, (_, index) => ({
            ...fixture, id: `older-${index}`, score_version: "reference-overlap-v7", gift_received: false, is_visible: true,
          })));
        }
        if (request.url.searchParams.has("id")) return json({ ...fixture, is_visible: isVisible });
        if (isAdminList) return json([{ ...fixture, gift_received: giftReceived, is_visible: isVisible }]);
        return json(request.url.searchParams.get("is_visible") === "eq.true" && !isVisible ? [] : [fixture]);
      }
      return new Response(JSON.stringify(fail ? { message: "database unavailable", code: "XX000" } : responseData), {
        status: fail ? 500 : 200, headers: { "Content-Type": "application/json" },
      });
    } },
  }) },
});
assert.deepEqual(await storage.listGurumiScores(10), [record]);
assert.equal(requests.at(-1).url.searchParams.get("order"), "score.desc,calibrated.desc,raw.desc,created_at.asc");
assert.equal(requests.at(-1).url.searchParams.get("limit"), "10");
assert.equal(requests.at(-1).url.searchParams.get("score_version"), `eq.${similarity.GURUMI_SCORE_VERSION}`);
assert.equal(requests.at(-1).url.searchParams.get("is_visible"), "eq.true");
assert.ok(!requests.at(-1).url.searchParams.get("select").includes("gift_received"));
assert.ok(!requests.at(-1).url.searchParams.get("select").includes("strokes"));
assert.equal(new Headers(requests.at(-1).headers).get("apikey"), "server-secret");
responseData = fixture;
assert.deepEqual(await storage.findGurumiScore(fixture.id), record);
assert.equal(requests.at(-1).url.searchParams.get("id"), "eq.test-record");
responseData = null;
assert.equal(await storage.findGurumiScore("missing"), null);
responseData = { strokes: "encoded-strokes" };
assert.deepEqual(await storage.findGurumiDrawing(fixture.id), responseData);
responseData = fixture;
assert.deepEqual(await storage.updateGurumiScore({ id: fixture.id, name: "수정", score: 42 }), record);
assert.equal(requests.at(-1).method, "PATCH");
assert.deepEqual(JSON.parse(requests.at(-1).body), { name: "수정", score: 42 });
responseData = null;
assert.equal(await storage.updateGurumiScore({ id: "missing", name: "수정", score: 42 }), null);
responseData = [{ id: fixture.id }];
assert.equal(await storage.deleteGurumiScore(fixture.id), true);
responseData = [];
assert.equal(await storage.deleteGurumiScore("missing"), false);
responseData = fixture;
assert.deepEqual(await storage.saveGurumiScore({ record, scoreDetails: zeroScore, strokes: "encoded", pointCount: 2 }), record);
const insert = requests.findLast((request) => request.method === "POST");
assert.equal(insert.url.searchParams.get("on_conflict"), "id");
assert.ok(new Headers(insert.headers).get("prefer").includes("resolution=ignore-duplicates"));
assert.deepEqual(JSON.parse(insert.body).part_scores, record.partScores);
assert.equal(JSON.parse(insert.body).strokes, "encoded");
assert.equal(JSON.parse(insert.body).character_id, "devops");
assert.equal(Object.hasOwn(JSON.parse(insert.body), "is_visible"), false);
responseData = { ...fixture, score: "invalid" };
await assert.rejects(storage.findGurumiScore(fixture.id), /invalid shape/);
fail = true;
await assert.rejects(storage.listGurumiScores(), (error) => error.message === "database unavailable");
giftMode = true;
assert.deepEqual(await storage.loadGurumiLeaderboard(), { leaderboard: [record], giftMinimumScore: 60 });
assert.deepEqual(await storage.loadGurumiAdminData(), {
  records: [{ ...record, giftReceived: false, isVisible: true }], giftMinimumScore: 60, giftReceivedCount: 0,
});
const adminQuery = requests.findLast(({ url }) => url.searchParams.get("select")?.includes("gift_received"));
assert.equal(adminQuery.url.searchParams.has("score_version"), false);
assert.equal(adminQuery.url.searchParams.has("is_visible"), false);
assert.ok(!adminQuery.url.searchParams.get("select").includes("strokes"));
pagedRecords = true;
const allAdminScores = (await storage.loadGurumiAdminData()).records;
assert.equal(allAdminScores.length, 1_001);
assert.equal(allAdminScores[1_000].scoreVersion, similarity.GURUMI_SCORE_VERSION);
pagedRecords = false;
assert.equal(await storage.updateGurumiGiftReceived(record.id, true), true);
assert.equal(await storage.updateGurumiGiftReceived(record.id, true), true);
await storage.updateGurumiGiftMinimumScore(72);
assert.deepEqual(await storage.loadGurumiAdminData(), {
  records: [{ ...record, giftReceived: true, isVisible: true }], giftMinimumScore: 72, giftReceivedCount: 1,
});
assert.deepEqual(await storage.loadGurumiLeaderboard(), { leaderboard: [record], giftMinimumScore: 72 });
assert.equal(await storage.updateGurumiScoreVisibility([record.id], false), 1);
assert.equal(requests.at(-1).url.searchParams.get("id"), "in.(test-record)");
assert.deepEqual(JSON.parse(requests.at(-1).body), { is_visible: false });
assert.deepEqual(await storage.loadGurumiLeaderboard(), { leaderboard: [], giftMinimumScore: 72 });
assert.deepEqual(await storage.findGurumiScore(record.id), { ...record, isVisible: false });
assert.deepEqual(await storage.loadGurumiAdminData(), {
  records: [{ ...record, giftReceived: true, isVisible: false }], giftMinimumScore: 72, giftReceivedCount: 1,
});
assert.equal(await storage.updateGurumiScoreVisibility([record.id], true), 1);
assert.deepEqual(await storage.loadGurumiLeaderboard(), { leaderboard: [record], giftMinimumScore: 72 });
assert.equal(await storage.updateGurumiScoreVisibility(["missing"], true), 0);
assert.equal(await storage.updateGurumiGiftReceived(record.id, false), true);
assert.equal((await storage.loadGurumiAdminData()).giftReceivedCount, 0);
assert.equal(await storage.updateGurumiGiftReceived("missing", true), false);
settingsMissing = true;
assert.equal((await storage.loadGurumiLeaderboard()).giftMinimumScore, 60);
await assert.rejects(storage.loadGurumiAdminData(), (error) => error.code === "PGRST205");
console.log("Supabase storage regression checks passed (real SDK, mocked HTTP; no live database).");

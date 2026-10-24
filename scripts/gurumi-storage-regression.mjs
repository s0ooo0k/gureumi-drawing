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
const requests = [];
const storage = compile("src/lib/gurumi/storage.ts", {
  "server-only": {}, "./records": records, "./similarity": similarity,
  "./database-config": { getGurumiDatabaseConfig: () => ({ url: "https://test.supabase.co", key: "server-secret" }) },
  "@supabase/supabase-js": { createClient: (url, key, options) => createClient(url, key, {
    ...options, global: { fetch: async (url, init) => {
      requests.push({ url: new URL(url), ...init });
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
await storage.listGurumiScores(10, { allVersions: true });
assert.equal(requests.at(-1).url.searchParams.has("score_version"), false);
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
responseData = { ...fixture, score: "invalid" };
await assert.rejects(storage.findGurumiScore(fixture.id), /invalid shape/);
fail = true;
await assert.rejects(storage.listGurumiScores(), (error) => error.message === "database unavailable");
console.log("Supabase storage regression checks passed (real SDK, mocked HTTP; no live database).");

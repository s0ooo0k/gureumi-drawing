import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";
import ts from "typescript";

function compileTypeScript(path, customRequire = (id) => {
  throw new Error(`Unexpected runtime import: ${id}`);
}) {
  const source = fs.readFileSync(path, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const moduleBox = { exports: {} };
  new Function("exports", "module", "require", javascript)(
    moduleBox.exports,
    moduleBox,
    customRequire,
  );
  return moduleBox.exports;
}

function ellipse(cx, cy, radiusX, radiusY, count = 72, rotation = 0) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const points = [];

  for (let index = 0; index <= count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const x = radiusX * Math.cos(angle);
    const y = radiusY * Math.sin(angle);
    points.push({
      x: cx + x * cosine - y * sine,
      y: cy + x * sine + y * cosine,
    });
  }
  return { points };
}

function concentricEllipses(count, spread, eccentricity) {
  return Array.from({ length: count }, (_, index) => {
    const ratio = (index + 1) / (count + 1);
    return ellipse(
      0.5,
      0.52,
      spread * ratio,
      spread * eccentricity * ratio,
      72,
      index * 0.17,
    );
  });
}

function encodeStroke(points) {
  const values = [];
  for (const point of points) {
    values.push(
      Math.round(Math.min(1, Math.max(0, point.x)) * 65_534),
      Math.round(Math.min(1, Math.max(0, point.y)) * 65_534),
    );
  }
  values.push(65_535, 65_535);
  const bytes = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => bytes.writeUInt16BE(value, index * 2));
  return bytes.toString("base64");
}

const characters = compileTypeScript("src/lib/gurumi/characters.ts");
const similarity = compileTypeScript("src/lib/gurumi/similarity.ts");
const codec = compileTypeScript(
  "src/lib/gurumi/stroke-codec.ts",
  (id) => {
    if (id === "./characters") return characters;
    if (id === "./similarity") return similarity;
    throw new Error(`Unexpected runtime import: ${id}`);
  },
);
const records = compileTypeScript(
  "src/lib/gurumi/records.ts",
  (id) => {
    if (id === "./characters") return characters;
    if (id === "./similarity") return similarity;
    throw new Error(`Unexpected runtime import: ${id}`);
  },
);
const databaseConfig = compileTypeScript("src/lib/gurumi/database-config.ts", (id) => {
  if (id === "server-only") return {};
  throw new Error(`Unexpected runtime import: ${id}`);
});
const defaultDatabase = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-secret" };
assert.deepEqual(databaseConfig.getGurumiDatabaseConfig(defaultDatabase), { url: defaultDatabase.SUPABASE_URL, key: "test-secret" });
assert.deepEqual(databaseConfig.getGurumiDatabaseConfig({ SUPABASE_URL: defaultDatabase.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: "legacy-key" }), { url: defaultDatabase.SUPABASE_URL, key: "legacy-key" });
assert.throws(() => databaseConfig.getGurumiDatabaseConfig({ SUPABASE_URL: defaultDatabase.SUPABASE_URL }));
assert.throws(() => databaseConfig.getGurumiDatabaseConfig({ SUPABASE_SECRET_KEY: "test-secret" }));
process.env.GURUMI_ROUND_SECRET = "gurumi-regression-secret";
const roundSession = compileTypeScript(
  "src/lib/gurumi/round-session.ts",
  (id) => {
    if (id === "server-only") return {};
    if (id === "node:crypto") return crypto;
    if (id === "./characters") return characters;
    if (id === "./records") return records;
    throw new Error(`Unexpected runtime import: ${id}`);
  },
);

assert.equal(records.normalizeGurumiName("😀"), null);
assert.equal(records.normalizeGurumiName("😀😀"), "😀😀");
assert.equal(records.normalizeGurumiName("  구르미   최고  "), "구르미 최고");

let drawingAuthenticated = false;
let drawingReads = 0;
const savedDrawing = encodeStroke([{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }]);
const drawingRoute = compileTypeScript("src/app/gurumi/admin/drawings/[id]/route.ts", (id) => {
  if (id === "@/lib/gurumi/admin-auth") return { isGurumiAdminAuthenticated: async () => drawingAuthenticated };
  if (id === "@/lib/gurumi/records") return records;
  if (id === "@/lib/gurumi/storage") return { findGurumiDrawing: async (recordId) => {
    drawingReads += 1;
    return recordId === "drawing-record" ? { strokes: savedDrawing } : null;
  } };
  throw new Error(`Unexpected runtime import: ${id}`);
});
const getDrawing = (id) => drawingRoute.GET(new Request("https://example.com/gurumi/admin/drawings/" + id), { params: Promise.resolve({ id }) });
assert.equal((await getDrawing("drawing-record")).status, 401);
assert.equal(drawingReads, 0, "Unauthenticated drawing requests must not query the database.");
drawingAuthenticated = true;
assert.equal((await getDrawing("invalid!")).status, 400);
assert.equal(drawingReads, 0);
assert.equal((await getDrawing("missing-record")).status, 404);
const drawingResponse = await getDrawing("drawing-record");
assert.equal(drawingResponse.status, 200);
assert.equal(drawingResponse.headers.get("cache-control"), "private, no-store");
assert.equal((await drawingResponse.json()).strokes, savedDrawing);
assert.equal(codec.decodeStrokes(savedDrawing).pointCount, 2);

const signedRound = roundSession.createGurumiRoundSession();
assert.equal(roundSession.verifyGurumiRoundSession(signedRound.token, signedRound.id), true);
const verifiedRound = roundSession.readGurumiRoundSession(signedRound.token, signedRound.id);
assert.ok(verifiedRound);
assert.equal(verifiedRound.id, signedRound.id);
assert.equal(verifiedRound.expiresAt - verifiedRound.issuedAt, 72 * 60 * 60 * 1_000);
assert.equal(
  roundSession.verifyGurumiRoundSession(
    signedRound.token,
    "00000000-0000-4000-8000-000000000000",
  ),
  false,
);

const venueRequest = new Request("https://example.com/api/gurumi/round", {
  headers: { "x-real-ip": "203.0.113.91" },
  method: "POST",
});
for (let index = 0; index < 120; index += 1) {
  assert.equal(roundSession.takeGurumiRateLimit(venueRequest, "round").allowed, true);
}
assert.equal(roundSession.takeGurumiRateLimit(venueRequest, "round").allowed, false);

const submissionRequest = new Request("https://example.com/api/gurumi/scores", {
  headers: { "x-real-ip": "203.0.113.92" },
  method: "POST",
});
for (let index = 0; index < 160; index += 1) {
  assert.equal(roundSession.takeGurumiRateLimit(submissionRequest, "submission").allowed, true);
}
assert.equal(
  roundSession.takeGurumiRateLimit(submissionRequest, "submission").allowed,
  false,
);

const { data, info } = await sharp("public/assets/ausgcon/gurumi/reference.png")
  .resize(similarity.GURUMI_SCORE_GRID_SIZE, similarity.GURUMI_SCORE_GRID_SIZE, {
    fit: "fill",
    kernel: sharp.kernel.cubic,
  })
  .ensureAlpha(1)
  .raw()
  .toBuffer({ resolveWithObject: true });
const reference = similarity.buildGurumiReferenceModel({
  data: new Uint8ClampedArray(data),
  height: info.height,
  width: info.width,
});

assert.equal(similarity.scoreDrawing([], reference).score, 0);

let highestEllipseScore = 0;
for (const count of [4, 5, 6, 7]) {
  for (const spread of [0.32, 0.38, 0.44]) {
    for (const eccentricity of [0.7, 0.9, 1]) {
      highestEllipseScore = Math.max(
        highestEllipseScore,
        similarity.scoreDrawing(
          concentricEllipses(count, spread, eccentricity),
          reference,
        ).score,
      );
    }
  }
}
assert.ok(
  highestEllipseScore <= 50,
  `Generic concentric ellipses scored too highly: ${highestEllipseScore}`,
);

const smoothPoints = Array.from({ length: 2_000 }, (_, index) => {
  const progress = index / 1_999;
  return {
    x: 0.1 + progress * 0.8,
    y: 0.5 + Math.sin(progress * Math.PI * 4) * 0.18,
  };
});
assert.equal(codec.decodeStrokes(encodeStroke(smoothPoints)).pointCount, smoothPoints.length);

const pathologicalPoints = Array.from({ length: 1_000 }, (_, index) =>
  index % 2 === 0 ? { x: 0.02, y: 0.02 } : { x: 0.98, y: 0.98 },
);
assert.throws(
  () => codec.decodeStrokes(encodeStroke(pathologicalPoints)),
  /too much segment work/,
);

console.log(
  `Gurumi regression checks passed (max generic ellipse score: ${highestEllipseScore}).`,
);

// Every shipped image must build independently, including transparent backgrounds.
function traceEdges(mask, size) {
  const visited = new Set();
  const strokes = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || visited.has(seed)) continue;
    let cursor = seed;
    const points = [];
    while (cursor !== undefined) {
      visited.add(cursor);
      const x = cursor % size, y = Math.floor(cursor / size);
      points.push({ x: x / size, y: y / size });
      cursor = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({ x: x + dx, y: y + dy })))
        .filter(p => p.x >= 0 && p.x < size && p.y >= 0 && p.y < size)
        .map(p => p.y * size + p.x).find(i => mask[i] && !visited.has(i));
    }
    if (points.length > 1) strokes.push({ points });
  }
  return strokes;
}
const modelMasks = new Set();
const adaptiveModels = [];
for (const character of characters.GURUMI_CHARACTERS) {
  const { data, info } = await sharp(`public${characters.characterImage(character.id)}`)
    .flatten({ background: "#ffffff" })
    .resize(similarity.GURUMI_SCORE_GRID_SIZE, similarity.GURUMI_SCORE_GRID_SIZE, { fit: "fill", kernel: sharp.kernel.cubic })
    .ensureAlpha(1).raw().toBuffer({ resolveWithObject: true });
  const model = similarity.buildGurumiReferenceModel({ data: new Uint8ClampedArray(data), width: info.width, height: info.height }, "adaptive");
  assert.ok(model.pixelCount > 100, `${character.id}: expected visible reference edges`);
  modelMasks.add(crypto.createHash("sha256").update(model.mask).digest("hex"));
  const traces = traceEdges(model.mask, info.width);
  const matched = similarity.scoreDrawing(traces, model);
  assert.ok(Number.isFinite(matched.score) && matched.raw > .5, `${character.id}: own contours must match (${matched.raw})`);
  assert.deepEqual(Object.keys(matched.parts), [...similarity.ADAPTIVE_PART_IDS]);
  assert.equal(similarity.scoreDrawing([], model).score, 0);
  assert.ok(similarity.scoreDrawing(concentricEllipses(5, .38, .9), model).score <= 60, `${character.id}: generic loops must not score highly`);
  adaptiveModels.push({ model, traces, matched });
}
assert.equal(modelMasks.size, 13, "All 13 characters must use different reference masks.");
const architecture = adaptiveModels[1];
const different = similarity.scoreDrawing(architecture.traces, adaptiveModels[12].model);
assert.ok(architecture.matched.raw > different.raw + .1, "Architecture contours must score higher against Architecture than Women in Cloud.");
assert.equal(records.isGurumiRoundSession(signedRound), true);
assert.ok(characters.isGurumiCharacterId(signedRound.characterId));
assert.equal(verifiedRound.characterId, signedRound.characterId);
const [originalPayload] = signedRound.token.split(".");
const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(originalPayload, "base64url")), characterId: signedRound.characterId === "busan" ? "devops" : "busan" })).toString("base64url");
assert.equal(roundSession.verifyGurumiRoundSession(`${tampered}.${signedRound.token.split(".")[1]}`, signedRound.id), false);
const legacyPayload = Buffer.from(JSON.stringify({ id: signedRound.id, version: 1, issuedAt: Date.now(), expiresAt: Date.now() + 60_000 })).toString("base64url");
const legacySignature = crypto.createHmac("sha256", process.env.GURUMI_ROUND_SECRET).update(`ausgcon-2026-gurumi-round:${legacyPayload}`).digest("base64url");
assert.equal(roundSession.readGurumiRoundSession(`${legacyPayload}.${legacySignature}`, signedRound.id).characterId, undefined);
console.log("KRUG checks passed: 13 image-specific models, contour discrimination, signed character IDs, and legacy round compatibility.");

let scoredCharacter;
let storedRecord;
const scoresRoute = compileTypeScript("src/app/api/gurumi/scores/route.ts", (id) => {
  if (id === "@/lib/gurumi/records") return records;
  if (id === "@/lib/gurumi/server-score") return { scoreGurumiDrawing: async (_strokes, characterId) => {
    scoredCharacter = characterId;
    return similarity.scoreDrawing([], reference);
  } };
  if (id === "@/lib/gurumi/stroke-codec") return { decodeStrokes: () => ({ strokes: [], pointCount: 0 }) };
  if (id === "@/lib/gurumi/round-session") return roundSession;
  if (id === "@/lib/gurumi/storage") return {
    findGurumiScore: async () => null, listGurumiScores: async () => [],
    saveGurumiScore: async ({ record }) => { storedRecord = record; return record; },
  };
  throw new Error(`Unexpected import: ${id}`);
});
const submissionResponse = await scoresRoute.POST(new Request("https://example.com/api/gurumi/scores", {
  method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.200" },
  body: JSON.stringify({ id: signedRound.id, name: "구르미", roundToken: signedRound.token, strokes: "", characterId: "forged-target" }),
}));
assert.equal(submissionResponse.status, 201);
assert.equal(scoredCharacter, signedRound.characterId, "Server scoring must use the signed target, ignoring a forged client target.");
assert.equal(storedRecord.characterId, signedRound.characterId);
console.log("Score API checks passed: server scoring and stored character match the signed round.");

const serverScoring = compileTypeScript("src/lib/gurumi/server-score.ts", (id) => {
  if (id === "server-only") return {};
  if (id === "node:path") return { default: path };
  if (id === "sharp") return { default: sharp };
  if (id === "./similarity") return similarity;
  if (id === "./characters") return characters;
  throw new Error(`Unexpected import: ${id}`);
});
assert.equal((await serverScoring.scoreGurumiDrawing(architecture.traces, "architecture")).score, architecture.matched.score);
await assert.rejects(serverScoring.scoreGurumiDrawing([], "../../unknown"), /Unknown Gurumi/);
console.log("Server image loading checks passed: selected asset path, scoring parity, unknown target rejection.");

const roundRoute = compileTypeScript("src/app/api/gurumi/round/route.ts", (id) => {
  if (id === "@/lib/gurumi/round-session") return roundSession;
  throw new Error(`Unexpected import: ${id}`);
});
assert.equal((await roundRoute.POST(new Request("https://example.com/api/gurumi/round", { method: "POST" }))).status, 409);
const newRound = await roundRoute.POST(new Request("https://example.com/api/gurumi/round", {
  method: "POST", headers: { "X-Gurumi-Client": "krug-v1", "x-real-ip": "203.0.113.202" },
}));
assert.equal(newRound.status, 201);
assert.ok(records.isGurumiRoundSession(await newRound.json()));
console.log("Round API checks passed: stale clients refresh; current clients receive a signed KRUG target.");

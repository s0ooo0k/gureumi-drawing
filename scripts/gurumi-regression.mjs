import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import fs from "node:fs";

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

const similarity = compileTypeScript("src/lib/gurumi/similarity.ts");
const codec = compileTypeScript(
  "src/lib/gurumi/stroke-codec.ts",
  (id) => {
    if (id === "./similarity") return similarity;
    throw new Error(`Unexpected runtime import: ${id}`);
  },
);
const records = compileTypeScript(
  "src/lib/gurumi/records.ts",
  (id) => {
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

import "server-only";

import path from "node:path";

import sharp from "sharp";

import {
  buildGurumiReferenceModel,
  GURUMI_SCORE_GRID_SIZE,
  scoreDrawing,
  type GurumiReferenceModel,
  type Stroke,
} from "./similarity";

import { characterImage, isGurumiCharacterId } from "./characters";

const models = new Map<string, Promise<GurumiReferenceModel>>();
async function buildServerReferenceModel(characterId?: string) {
  if (characterId !== undefined && !isGurumiCharacterId(characterId)) throw new Error("Unknown Gurumi character.");
  const { data, info } = await sharp(path.join(process.cwd(), "public", characterImage(characterId)))
    .flatten({ background: "#ffffff" })
    .resize(GURUMI_SCORE_GRID_SIZE, GURUMI_SCORE_GRID_SIZE, { fit: "fill", kernel: sharp.kernel.cubic })
    .ensureAlpha(1).raw().toBuffer({ resolveWithObject: true });
  return buildGurumiReferenceModel({ data: new Uint8ClampedArray(data), height: info.height, width: info.width } as ImageData,
    characterId ? "adaptive" : "legacy");
}
export async function scoreGurumiDrawing(strokes: Stroke[], characterId?: string) {
  const key = characterId ?? "legacy";
  let model = models.get(key);
  if (!model) {
    model = buildServerReferenceModel(characterId).catch((error: unknown) => { models.delete(key); throw error; });
    models.set(key, model);
  }
  return scoreDrawing(strokes, await model);
}

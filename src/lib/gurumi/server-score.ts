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

let referenceModelPromise: Promise<GurumiReferenceModel> | null = null;

async function buildServerReferenceModel() {
  const referencePath = path.join(
    process.cwd(),
    "public",
    "assets",
    "ausgcon",
    "gurumi",
    "reference.png",
  );
  const { data, info } = await sharp(referencePath)
    .resize(GURUMI_SCORE_GRID_SIZE, GURUMI_SCORE_GRID_SIZE, {
      fit: "fill",
      kernel: sharp.kernel.cubic,
    })
    .ensureAlpha(1)
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (
    info.width !== GURUMI_SCORE_GRID_SIZE ||
    info.height !== GURUMI_SCORE_GRID_SIZE ||
    info.channels !== 4
  ) {
    throw new Error("The Gurumi reference image could not be normalized.");
  }

  const imageData = {
    data: new Uint8ClampedArray(data),
    height: info.height,
    width: info.width,
  } as ImageData;

  return buildGurumiReferenceModel(imageData);
}

async function getServerReferenceModel() {
  if (!referenceModelPromise) {
    referenceModelPromise = buildServerReferenceModel().catch((error: unknown) => {
      referenceModelPromise = null;
      throw error;
    });
  }
  return referenceModelPromise;
}

export async function scoreGurumiDrawing(strokes: Stroke[]) {
  return scoreDrawing(strokes, await getServerReferenceModel());
}

export type StrokePoint = {
  x: number;
  y: number;
};

export type Stroke = {
  points: StrokePoint[];
};

export const GURUMI_SCORE_GRID_SIZE = 128;
export const GURUMI_SCORE_VERSION = "semantic-shape-v3";

export const GURUMI_PART_IDS = [
  "body",
  "eyes",
  "cap",
  "raisedArm",
  "propHand",
  "face",
  "feet",
] as const;

export type GurumiPartId = (typeof GURUMI_PART_IDS)[number];

export type PartScore = {
  score: number;
  precision: number;
  recall: number;
};

export type SimilarityScore = {
  score: number;
  calibrated: number;
  raw: number;
  semantic: number;
  global: number;
  precision: number;
  recall: number;
  structure: number;
  unmatchedInk: number;
  poseCoverage: number;
  densityRatio: number;
  overdrawEfficiency: number;
  orientationEntropy: number;
  loopMonotony: number;
  dominantDirection: number;
  strokeLength: number;
  scoreCap: number;
  parts: Record<GurumiPartId, PartScore>;
};

const FEATURE_IDS = [
  "body",
  "capOuter",
  "capDetail",
  "raisedArmOuter",
  "raisedArmInner",
  "leftEye",
  "rightEye",
  "nose",
  "mouth",
  "prop",
  "holdingHand",
  "leftFoot",
  "lowerFoot",
] as const;

type FeatureId = (typeof FEATURE_IDS)[number];

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Point = readonly [number, number];
type Polygon = readonly Point[];

type FeatureReference = {
  mask: Uint8Array;
  distances: Float32Array;
  orientations: Float32Array;
  pixelCount: number;
};

export type GurumiReferenceModel = {
  version: typeof GURUMI_SCORE_VERSION;
  mask: Uint8Array;
  distances: Float32Array;
  orientations: Float32Array;
  bounds: Bounds;
  pixelCount: number;
  features: Record<FeatureId, FeatureReference>;
};

const GRID_SIZE = GURUMI_SCORE_GRID_SIZE;
const EDGE_THRESHOLD = 82;
const GLOBAL_MATCH_SIGMA = 3.8;
const FEATURE_MATCH_SIGMA = 2.4;
const SQRT_TWO = Math.SQRT2;
const LARGE_DISTANCE = 1_000_000;
const ORIENTATION_BIN_COUNT = 12;

const CAP_POLYGON: Polygon = [
  [34, 32], [38, 24], [46, 18], [54, 15], [63, 14], [72, 15],
  [81, 19], [88, 26], [92, 33], [94, 40], [91, 41], [79, 37],
  [64, 34], [48, 33],
];

const RAISED_ARM_POLYGON: Polygon = [
  [16, 35], [20, 31], [27, 30], [33, 33], [37, 38], [38, 45],
  [44, 53], [44, 57], [39, 61], [32, 65], [27, 62], [22, 57],
  [18, 51], [15, 43],
];

const LEFT_EYE_POLYGON: Polygon = [
  [45, 34], [51, 34], [57, 38], [61, 46], [61, 57], [58, 67],
  [53, 72], [47, 72], [41, 68], [38, 62], [37, 54], [38, 46],
  [41, 39],
];

const RIGHT_EYE_POLYGON: Polygon = [
  [74, 37], [80, 37], [84, 41], [87, 48], [87, 59], [84, 69],
  [80, 75], [74, 76], [69, 71], [67, 64], [67, 53], [69, 44],
];

const PROP_POLYGON: Polygon = [
  [62, 77], [75, 74], [82, 75], [85, 80], [85, 94], [68, 98],
  [64, 95],
];

const HOLDING_HAND_POLYGON: Polygon = [
  [73, 75], [82, 74], [87, 77], [89, 80], [92, 80], [92, 87],
  [88, 92], [82, 95], [75, 94], [70, 91], [68, 86], [69, 80],
];

const LEFT_FOOT_POLYGON: Polygon = [
  [36, 76], [39, 72], [46, 70], [52, 72], [56, 77], [58, 84],
  [55, 90], [50, 94], [43, 94], [38, 90], [36, 85],
];

const LOWER_FOOT_POLYGON: Polygon = [
  [49, 80], [57, 79], [66, 81], [76, 79], [81, 84], [82, 94],
  [80, 102], [75, 107], [66, 109], [58, 106], [51, 101], [48, 95],
];

const BODY_POLYGON: Polygon = [
  [28, 38], [35, 35], [43, 33], [55, 33], [67, 34], [79, 36],
  [90, 40], [91, 44], [97, 47], [102, 53], [105, 61], [103, 69],
  [99, 74], [94, 78], [86, 81], [77, 80], [70, 78], [63, 82],
  [54, 83], [47, 81], [41, 77], [35, 74], [30, 69], [26, 62],
  [25, 53], [26, 45],
];

const FEATURE_ZONES: Record<FeatureId, readonly Polygon[]> = {
  body: [BODY_POLYGON],
  capOuter: [CAP_POLYGON],
  capDetail: [
    [[55, 17], [81, 17], [82, 35], [55, 35]],
    [[33, 28], [51, 28], [65, 30], [80, 33], [96, 38], [96, 44],
      [79, 39], [63, 36], [47, 34], [33, 34]],
  ],
  raisedArmOuter: [RAISED_ARM_POLYGON],
  raisedArmInner: [
    [[30, 35], [36, 34], [40, 41], [46, 53], [46, 58], [41, 61],
      [36, 54], [32, 46]],
  ],
  leftEye: [LEFT_EYE_POLYGON],
  rightEye: [RIGHT_EYE_POLYGON],
  nose: [[[61, 48], [69, 48], [69, 57], [61, 57]]],
  mouth: [[[59, 59], [69, 59], [69, 71], [59, 71]]],
  prop: [PROP_POLYGON],
  holdingHand: [HOLDING_HAND_POLYGON],
  leftFoot: [LEFT_FOOT_POLYGON],
  lowerFoot: [LOWER_FOOT_POLYGON],
};

// First match wins so every reference pixel has exactly one semantic owner.
const FEATURE_PRIORITY: readonly FeatureId[] = [
  "capDetail",
  "capOuter",
  "raisedArmInner",
  "raisedArmOuter",
  "leftEye",
  "rightEye",
  "nose",
  "mouth",
  "holdingHand",
  "prop",
  "leftFoot",
  "lowerFoot",
  "body",
];

const FEATURE_DILATION: Record<FeatureId, number> = {
  body: 2,
  capOuter: 2,
  capDetail: 1,
  raisedArmOuter: 2,
  raisedArmInner: 1,
  leftEye: 1,
  rightEye: 1,
  nose: 1,
  mouth: 1,
  prop: 2,
  holdingHand: 2,
  leftFoot: 2,
  lowerFoot: 2,
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(min: number, max: number, value: number) {
  const normalized = clamp((value - min) / (max - min));
  return normalized * normalized * (3 - 2 * normalized);
}

function createRecord<Key extends string, Value>(
  keys: readonly Key[],
  createValue: (key: Key) => Value,
) {
  return Object.fromEntries(keys.map((key) => [key, createValue(key)])) as Record<Key, Value>;
}

function pointOnSegment(x: number, y: number, start: Point, end: Point) {
  const cross = (x - start[0]) * (end[1] - start[1]) -
    (y - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > 1e-9) return false;

  return (
    x >= Math.min(start[0], end[0]) && x <= Math.max(start[0], end[0]) &&
    y >= Math.min(start[1], end[1]) && y <= Math.max(start[1], end[1])
  );
}

function pointInPolygon(x: number, y: number, polygon: Polygon) {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(x, y, start, end)) return true;

    const intersects =
      (start[1] > y) !== (end[1] > y) &&
      x < ((end[0] - start[0]) * (y - start[1])) / (end[1] - start[1]) + start[0];
    if (intersects) inside = !inside;
  }

  return inside;
}

function rasterizePolygons(polygons: readonly Polygon[]) {
  const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (polygons.some((polygon) => pointInPolygon(x, y, polygon))) {
        mask[y * GRID_SIZE + x] = 1;
      }
    }
  }

  return mask;
}

function dilate(mask: Uint8Array, radius: number) {
  const result = new Uint8Array(mask.length);

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!mask[y * GRID_SIZE + x]) continue;

      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= GRID_SIZE) continue;

        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= GRID_SIZE) continue;
          result[nextY * GRID_SIZE + nextX] = 1;
        }
      }
    }
  }

  return result;
}

const FEATURE_ZONE_MASKS = createRecord(FEATURE_IDS, (feature) =>
  dilate(rasterizePolygons(FEATURE_ZONES[feature]), FEATURE_DILATION[feature]),
);

function colorDistance(
  data: Uint8ClampedArray,
  firstIndex: number,
  secondIndex: number,
) {
  const red = data[firstIndex] - data[secondIndex];
  const green = data[firstIndex + 1] - data[secondIndex + 1];
  const blue = data[firstIndex + 2] - data[secondIndex + 2];

  return Math.sqrt(red * red + green * green + blue * blue);
}

function buildReferenceEdges(imageData: ImageData) {
  const { data, width, height } = imageData;
  const edges = new Uint8Array(width * height);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const strongestDifference = Math.max(
        colorDistance(data, index, (pixel + 1) * 4),
        colorDistance(data, index, (pixel + width) * 4),
        colorDistance(data, index, (pixel + width + 1) * 4),
      );

      if (strongestDifference >= EDGE_THRESHOLD) edges[pixel] = 1;
    }
  }

  return edges;
}

function getMaskBounds(mask: Uint8Array, width: number, height: number): Bounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return maxX >= 0 ? { minX, minY, maxX, maxY } : null;
}

function getRobustStrokeBounds(strokes: Stroke[]): Bounds | null {
  const xCoordinates: number[] = [];
  const yCoordinates: number[] = [];
  const samplingStep = 1 / GRID_SIZE;

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    xCoordinates.push(stroke.points[0].x);
    yCoordinates.push(stroke.points[0].y);

    for (let index = 1; index < stroke.points.length; index += 1) {
      const start = stroke.points[index - 1];
      const end = stroke.points[index];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const sampleCount = Math.max(1, Math.ceil(length / samplingStep));

      for (let sample = 1; sample <= sampleCount; sample += 1) {
        const progress = sample / sampleCount;
        xCoordinates.push(start.x + (end.x - start.x) * progress);
        yCoordinates.push(start.y + (end.y - start.y) * progress);
      }
    }
  }

  if (xCoordinates.length === 0) return null;
  xCoordinates.sort((first, second) => first - second);
  yCoordinates.sort((first, second) => first - second);

  const trim = xCoordinates.length >= 40 ? 0.01 : 0;
  const lowerIndex = Math.floor((xCoordinates.length - 1) * trim);
  const upperIndex = Math.ceil((xCoordinates.length - 1) * (1 - trim));

  return {
    minX: xCoordinates[lowerIndex],
    minY: yCoordinates[lowerIndex],
    maxX: xCoordinates[upperIndex],
    maxY: yCoordinates[upperIndex],
  };
}

function analyzeStrokes(strokes: Stroke[]) {
  const orientationBins = new Float64Array(ORIENTATION_BIN_COUNT);
  let strokeLength = 0;
  let analyzedLength = 0;
  let strokeCount = 0;
  let closedLoopCount = 0;
  let radialLoopCount = 0;
  const minimumSegmentLength = 1 / GRID_SIZE;

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    strokeCount += 1;
    if (stroke.points.length >= 12) {
      const first = stroke.points[0];
      const last = stroke.points[stroke.points.length - 1];
      const closed = Math.hypot(last.x - first.x, last.y - first.y) <= 0.035;
      const sampledAngles: number[] = [];
      const stride = Math.max(1, Math.floor(stroke.points.length / 48));
      for (let index = 0; index < stroke.points.length; index += stride) {
        const sample = stroke.points[index];
        sampledAngles.push(Math.atan2(sample.y - 0.5, sample.x - 0.5));
      }
      let accumulated = 0;
      const radii: number[] = [];
      for (let index = 1; index < sampledAngles.length; index += 1) {
        let delta = sampledAngles[index] - sampledAngles[index - 1];
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        accumulated += delta;
        const sampleIndex = Math.min(stroke.points.length - 1, index * stride);
        const sample = stroke.points[sampleIndex];
        radii.push(Math.hypot(sample.x - 0.5, sample.y - 0.5));
      }
      if (closed && Math.abs(accumulated) >= Math.PI * 1.35 && radii.length > 0) {
        closedLoopCount += 1;
        const averageRadius = radii.reduce((total, radius) => total + radius, 0) / radii.length;
        const radialVariance = radii.reduce(
          (total, radius) => total + (radius - averageRadius) ** 2,
          0,
        ) / radii.length;
        const radialVariation = Math.sqrt(radialVariance) / Math.max(averageRadius, 0.001);
        if (radialVariation < 0.22) radialLoopCount += 1;
      }
    }
    let orientationAnchor = stroke.points[0];

    for (let index = 1; index < stroke.points.length; index += 1) {
      const previous = stroke.points[index - 1];
      const current = stroke.points[index];
      strokeLength += Math.hypot(current.x - previous.x, current.y - previous.y);

      const isLastPoint = index === stroke.points.length - 1;
      const deltaX = current.x - orientationAnchor.x;
      const deltaY = current.y - orientationAnchor.y;
      const length = Math.hypot(deltaX, deltaY);
      if (length < minimumSegmentLength && !isLastPoint) continue;
      if (length === 0) continue;

      let angle = Math.atan2(deltaY, deltaX) % Math.PI;
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(
        ORIENTATION_BIN_COUNT - 1,
        Math.floor((angle / Math.PI) * ORIENTATION_BIN_COUNT),
      );
      orientationBins[bin] += length;
      analyzedLength += length;
      orientationAnchor = current;
    }
  }

  let entropy = 0;
  let dominantDirection = 0;
  if (analyzedLength > 0) {
    for (const binLength of orientationBins) {
      const probability = binLength / analyzedLength;
      if (probability > 0) entropy -= probability * Math.log(probability);
      dominantDirection = Math.max(dominantDirection, probability);
    }
    entropy /= Math.log(ORIENTATION_BIN_COUNT);
  }

  return {
    strokeLength,
    strokeCount,
    radialLoopCount,
    orientationEntropy: entropy,
    dominantDirection,
    angularMonotony: closedLoopCount > 0 ? radialLoopCount / closedLoopCount : 0,
  };
}

function stamp(mask: Uint8Array, x: number, y: number, radius = 1) {
  const centerX = Math.round(x);
  const centerY = Math.round(y);

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX * offsetX + offsetY * offsetY > radius * radius + 0.5) continue;
      const nextX = centerX + offsetX;
      const nextY = centerY + offsetY;
      if (nextX < 0 || nextY < 0 || nextX >= GRID_SIZE || nextY >= GRID_SIZE) continue;
      mask[nextY * GRID_SIZE + nextX] = 1;
    }
  }
}

function rasterizeSegment(
  mask: Uint8Array,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(endX - startX), Math.abs(endY - startY)) * 1.5),
  );

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    stamp(mask, startX + (endX - startX) * progress, startY + (endY - startY) * progress);
  }
}

type DrawingTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  userCenterX: number;
  userCenterY: number;
  referenceCenterX: number;
  referenceCenterY: number;
};

function rasterizeStrokes(strokes: Stroke[], transform: DrawingTransform) {
  const mask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const orientationCosine = new Float32Array(mask.length);
  const orientationSine = new Float32Array(mask.length);
  const orientationWeights = new Uint16Array(mask.length);
  const transformPoint = (point: StrokePoint) => ({
    x: transform.referenceCenterX + transform.offsetX +
      (point.x - transform.userCenterX) * transform.scale,
    y: transform.referenceCenterY + transform.offsetY +
      (point.y - transform.userCenterY) * transform.scale,
  });

  const stampOrientation = (x: number, y: number, angle: number) => {
    const centerX = Math.round(x);
    const centerY = Math.round(y);
    const cosine = Math.cos(angle * 2);
    const sine = Math.sin(angle * 2);

    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX * offsetX + offsetY * offsetY > 1.5) continue;
        const nextX = centerX + offsetX;
        const nextY = centerY + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= GRID_SIZE || nextY >= GRID_SIZE) continue;
        const index = nextY * GRID_SIZE + nextX;
        orientationCosine[index] += cosine;
        orientationSine[index] += sine;
        orientationWeights[index] += 1;
      }
    }
  };

  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    let previous = transformPoint(stroke.points[0]);
    stamp(mask, previous.x, previous.y);

    for (let index = 1; index < stroke.points.length; index += 1) {
      const current = transformPoint(stroke.points[index]);
      rasterizeSegment(mask, previous.x, previous.y, current.x, current.y);
      const angle = Math.atan2(current.y - previous.y, current.x - previous.x);
      const steps = Math.max(
        1,
        Math.ceil(Math.max(Math.abs(current.x - previous.x), Math.abs(current.y - previous.y)) * 1.5),
      );
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        stampOrientation(
          previous.x + (current.x - previous.x) * progress,
          previous.y + (current.y - previous.y) * progress,
          angle,
        );
      }
      previous = current;
    }
  }

  const orientations = new Float32Array(mask.length);
  for (let index = 0; index < orientations.length; index += 1) {
    if (!orientationWeights[index]) continue;
    orientations[index] = Math.atan2(orientationSine[index], orientationCosine[index]) / 2;
  }

  return { mask, orientations };
}

function buildMaskOrientations(mask: Uint8Array) {
  const orientations = new Float32Array(mask.length);

  for (let y = 1; y < GRID_SIZE - 1; y += 1) {
    for (let x = 1; x < GRID_SIZE - 1; x += 1) {
      const index = y * GRID_SIZE + x;
      if (!mask[index]) continue;

      const gradientX =
        mask[index + 1] - mask[index - 1] +
        0.5 * (mask[index - GRID_SIZE + 1] - mask[index - GRID_SIZE - 1]) +
        0.5 * (mask[index + GRID_SIZE + 1] - mask[index + GRID_SIZE - 1]);
      const gradientY =
        mask[index + GRID_SIZE] - mask[index - GRID_SIZE] +
        0.5 * (mask[index + GRID_SIZE - 1] - mask[index - GRID_SIZE - 1]) +
        0.5 * (mask[index + GRID_SIZE + 1] - mask[index - GRID_SIZE + 1]);

      if (gradientX || gradientY) orientations[index] = Math.atan2(gradientY, gradientX) + Math.PI / 2;
    }
  }

  return orientations;
}

function distanceTransform(mask: Uint8Array, width = GRID_SIZE, height = GRID_SIZE) {
  const distances = new Float32Array(width * height);

  for (let index = 0; index < mask.length; index += 1) {
    distances[index] = mask[index] ? 0 : LARGE_DISTANCE;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let distance = distances[index];
      if (x > 0) distance = Math.min(distance, distances[index - 1] + 1);
      if (y > 0) distance = Math.min(distance, distances[index - width] + 1);
      if (x > 0 && y > 0) distance = Math.min(distance, distances[index - width - 1] + SQRT_TWO);
      if (x < width - 1 && y > 0) distance = Math.min(distance, distances[index - width + 1] + SQRT_TWO);
      distances[index] = distance;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let distance = distances[index];
      if (x < width - 1) distance = Math.min(distance, distances[index + 1] + 1);
      if (y < height - 1) distance = Math.min(distance, distances[index + width] + 1);
      if (x < width - 1 && y < height - 1) distance = Math.min(distance, distances[index + width + 1] + SQRT_TWO);
      if (x > 0 && y < height - 1) distance = Math.min(distance, distances[index + width - 1] + SQRT_TWO);
      distances[index] = distance;
    }
  }

  return distances;
}

function directionalMatch(
  source: Uint8Array,
  targetDistances: Float32Array,
  sigma: number,
  sourceOrientations?: Float32Array,
  targetOrientations?: Float32Array,
) {
  let total = 0;
  let count = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (!source[index]) continue;
    const distance = targetDistances[index];
    let orientationFactor = 1;
    if (sourceOrientations && targetOrientations && distance <= sigma * 2.5) {
      const x = index % GRID_SIZE;
      const y = Math.floor(index / GRID_SIZE);
      const searchRadius = Math.ceil(Math.min(distance + 1, sigma * 2.5));
      let nearestIndex = index;
      let nearestDistanceSquared = LARGE_DISTANCE;

      for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY += 1) {
        const targetY = y + offsetY;
        if (targetY < 0 || targetY >= GRID_SIZE) continue;
        for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX += 1) {
          const targetX = x + offsetX;
          if (targetX < 0 || targetX >= GRID_SIZE) continue;
          const candidate = targetY * GRID_SIZE + targetX;
          if (targetDistances[candidate] !== 0) continue;
          const distanceSquared = offsetX * offsetX + offsetY * offsetY;
          if (distanceSquared < nearestDistanceSquared) {
            nearestDistanceSquared = distanceSquared;
            nearestIndex = candidate;
          }
        }
      }

      const difference = sourceOrientations[index] - targetOrientations[nearestIndex];
      orientationFactor = 0.82 + 0.18 * Math.cos(difference) ** 2;
    }
    total += Math.exp(-(distance * distance) / (2 * sigma * sigma)) * orientationFactor;
    count += 1;
  }

  return count > 0 ? total / count : 0;
}

function fBeta(precision: number, recall: number, beta = 0.65) {
  if (precision === 0 || recall === 0) return 0;
  const betaSquared = beta * beta;
  return ((1 + betaSquared) * precision * recall) / (betaSquared * precision + recall);
}

function countMaskPixels(mask: Uint8Array) {
  let count = 0;
  for (const pixel of mask) count += pixel;
  return count;
}

function absoluteCellIoU(first: Uint8Array, second: Uint8Array, cellCount = 16) {
  const firstCells = new Uint16Array(cellCount * cellCount);
  const secondCells = new Uint16Array(cellCount * cellCount);

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = y * GRID_SIZE + x;
      const cellX = Math.min(cellCount - 1, Math.floor((x / GRID_SIZE) * cellCount));
      const cellY = Math.min(cellCount - 1, Math.floor((y / GRID_SIZE) * cellCount));
      const cellIndex = cellY * cellCount + cellX;
      firstCells[cellIndex] += first[index];
      secondCells[cellIndex] += second[index];
    }
  }

  let intersection = 0;
  let union = 0;
  for (let index = 0; index < firstCells.length; index += 1) {
    intersection += Math.min(firstCells[index], secondCells[index]);
    union += Math.max(firstCells[index], secondCells[index]);
  }

  return union > 0 ? intersection / union : 0;
}

function absoluteCellCoverage(userMask: Uint8Array, referenceMask: Uint8Array, cellCount = 8) {
  const cellPixelCount = (GRID_SIZE / cellCount) ** 2;
  const userCells = new Uint16Array(cellCount * cellCount);
  const referenceCells = new Uint16Array(cellCount * cellCount);

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = y * GRID_SIZE + x;
      const cellX = Math.min(cellCount - 1, Math.floor((x / GRID_SIZE) * cellCount));
      const cellY = Math.min(cellCount - 1, Math.floor((y / GRID_SIZE) * cellCount));
      const cellIndex = cellY * cellCount + cellX;
      userCells[cellIndex] += userMask[index];
      referenceCells[cellIndex] += referenceMask[index];
    }
  }

  let coveredWeight = 0;
  let referenceWeight = 0;
  for (let index = 0; index < referenceCells.length; index += 1) {
    const referenceDensity = referenceCells[index] / cellPixelCount;
    if (referenceDensity < 0.018) continue;
    const weight = Math.sqrt(referenceDensity);
    const userDensity = userCells[index] / cellPixelCount;
    referenceWeight += weight;
    coveredWeight += weight * clamp(userDensity / Math.max(0.025, referenceDensity * 0.45));
  }

  return referenceWeight > 0 ? coveredWeight / referenceWeight : 0;
}

function findBestAlignedMask(
  strokes: Stroke[],
  userBounds: Bounds,
  reference: GurumiReferenceModel,
) {
  const userWidth = Math.max(userBounds.maxX - userBounds.minX, 0.001);
  const userHeight = Math.max(userBounds.maxY - userBounds.minY, 0.001);
  const referenceWidth = reference.bounds.maxX - reference.bounds.minX;
  const referenceHeight = reference.bounds.maxY - reference.bounds.minY;
  const baseScale = Math.min(referenceWidth / userWidth, referenceHeight / userHeight) * 0.98;
  const baseTransform = {
    userCenterX: (userBounds.minX + userBounds.maxX) / 2,
    userCenterY: (userBounds.minY + userBounds.maxY) / 2,
    referenceCenterX: (reference.bounds.minX + reference.bounds.maxX) / 2,
    referenceCenterY: (reference.bounds.minY + reference.bounds.maxY) / 2,
  };
  const scaleFactors = [0.9, 1, 1.1] as const;
  const offsets = [-3, 0, 3] as const;
  let bestMask = new Uint8Array(GRID_SIZE * GRID_SIZE);
  let bestOrientations = new Float32Array(GRID_SIZE * GRID_SIZE);
  let bestTransform: DrawingTransform = { ...baseTransform, scale: baseScale, offsetX: 0, offsetY: 0 };
  let bestPrecision = 0;
  let bestRecall = 0;
  let bestStructure = 0;
  let bestObjective = -1;

  for (const scaleFactor of scaleFactors) {
    for (const offsetX of offsets) {
      for (const offsetY of offsets) {
        const transform: DrawingTransform = {
          ...baseTransform,
          scale: baseScale * scaleFactor,
          offsetX,
          offsetY,
        };
        const rasterized = rasterizeStrokes(strokes, transform);
        const mask = rasterized.mask;
        const userDistances = distanceTransform(mask);
        const precision = directionalMatch(
          mask,
          reference.distances,
          GLOBAL_MATCH_SIGMA,
          rasterized.orientations,
          reference.orientations,
        );
        const recall = directionalMatch(
          reference.mask,
          userDistances,
          GLOBAL_MATCH_SIGMA,
          reference.orientations,
          rasterized.orientations,
        );
        const structure = absoluteCellIoU(mask, reference.mask);
        const alignmentPenalty = Math.abs(Math.log(scaleFactor)) * 0.004 +
          (Math.abs(offsetX) + Math.abs(offsetY)) * 0.0004;
        const objective = fBeta(precision, recall) * 0.8 + structure * 0.2 - alignmentPenalty;

        if (objective > bestObjective) {
          bestObjective = objective;
          bestMask = mask;
          bestOrientations = rasterized.orientations;
          bestTransform = transform;
          bestPrecision = precision;
          bestRecall = recall;
          bestStructure = structure;
        }
      }
    }
  }

  return {
    mask: bestMask,
    orientations: bestOrientations,
    transform: bestTransform,
    precision: bestPrecision,
    recall: bestRecall,
    structure: bestStructure,
  };
}

export function buildGurumiReferenceModel(imageData: ImageData): GurumiReferenceModel {
  if (imageData.width !== GRID_SIZE || imageData.height !== GRID_SIZE) {
    throw new Error(`Reference image must be ${GRID_SIZE}x${GRID_SIZE}px.`);
  }

  const mask = buildReferenceEdges(imageData);
  const bounds = getMaskBounds(mask, GRID_SIZE, GRID_SIZE);
  if (!bounds) throw new Error("Reference image does not contain detectable lines.");

  const featureMasks = createRecord(FEATURE_IDS, () => new Uint8Array(mask.length));

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const feature = FEATURE_PRIORITY.find((candidate) => FEATURE_ZONE_MASKS[candidate][index]) ?? "body";
    featureMasks[feature][index] = 1;
  }

  const features = createRecord(FEATURE_IDS, (feature) => ({
    mask: featureMasks[feature],
    distances: distanceTransform(featureMasks[feature]),
    orientations: buildMaskOrientations(featureMasks[feature]),
    pixelCount: countMaskPixels(featureMasks[feature]),
  }));

  for (const feature of FEATURE_IDS) {
    if (features[feature].pixelCount === 0) {
      throw new Error(`Reference feature ${feature} does not contain detectable lines.`);
    }
  }

  return {
    version: GURUMI_SCORE_VERSION,
    mask,
    distances: distanceTransform(mask),
    orientations: buildMaskOrientations(mask),
    bounds,
    pixelCount: countMaskPixels(mask),
    features,
  };
}

type FeatureScore = PartScore;

function combineFeatureScores(
  featureScores: Record<FeatureId, FeatureScore>,
  components: readonly { id: FeatureId; weight: number }[],
  balanceWeight: number,
): PartScore {
  const combineMetric = (metric: keyof FeatureScore) => {
    const mean = components.reduce(
      (total, component) => total + featureScores[component.id][metric] * component.weight,
      0,
    );
    const minimum = Math.min(...components.map((component) => featureScores[component.id][metric]));
    return mean * (1 - balanceWeight) + minimum * balanceWeight;
  };

  return {
    score: combineMetric("score"),
    precision: combineMetric("precision"),
    recall: combineMetric("recall"),
  };
}

function emptyPartScores() {
  return createRecord(GURUMI_PART_IDS, () => ({ score: 0, precision: 0, recall: 0 }));
}

function emptyScore(strokeLength = 0): SimilarityScore {
  return {
    score: 0,
    calibrated: 0,
    raw: 0,
    semantic: 0,
    global: 0,
    precision: 0,
    recall: 0,
    structure: 0,
    unmatchedInk: 1,
    poseCoverage: 0,
    densityRatio: 0,
    overdrawEfficiency: 0,
    orientationEntropy: 0,
    loopMonotony: 0,
    dominantDirection: 0,
    strokeLength,
    scoreCap: 99,
    parts: emptyPartScores(),
  };
}

export function scoreDrawing(strokes: Stroke[], reference: GurumiReferenceModel): SimilarityScore {
  const strokeAnalysis = analyzeStrokes(strokes);
  const userBounds = getRobustStrokeBounds(strokes);
  if (!userBounds || strokeAnalysis.strokeLength === 0) {
    return emptyScore(strokeAnalysis.strokeLength);
  }

  const alignment = findBestAlignedMask(strokes, userBounds, reference);
  const userMask = alignment.mask;
  const userInk = countMaskPixels(userMask);
  if (userInk === 0) return emptyScore(strokeAnalysis.strokeLength);

  const assignedUserMasks = createRecord(FEATURE_IDS, () => new Uint8Array(userMask.length));
  let unmatchedInkPixels = 0;

  for (let index = 0; index < userMask.length; index += 1) {
    if (!userMask[index]) continue;
    let nearestFeature: FeatureId = FEATURE_IDS[0];
    let nearestDistance = reference.features[nearestFeature].distances[index];

    for (let featureIndex = 1; featureIndex < FEATURE_IDS.length; featureIndex += 1) {
      const feature = FEATURE_IDS[featureIndex];
      const distance = reference.features[feature].distances[index];
      if (distance < nearestDistance) {
        nearestFeature = feature;
        nearestDistance = distance;
      }
    }

    assignedUserMasks[nearestFeature][index] = 1;
    if (nearestDistance > 6) unmatchedInkPixels += 1;
  }

  const featureScores = createRecord(FEATURE_IDS, (feature) => {
    const userFeatureMask = assignedUserMasks[feature];
    const userFeatureDistances = distanceTransform(userFeatureMask);
    const precision = directionalMatch(
      userFeatureMask,
      reference.features[feature].distances,
      FEATURE_MATCH_SIGMA,
      alignment.orientations,
      reference.features[feature].orientations,
    );
    const recall = directionalMatch(
      reference.features[feature].mask,
      userFeatureDistances,
      FEATURE_MATCH_SIGMA,
      reference.features[feature].orientations,
      alignment.orientations,
    );

    // A short line can be very precise while covering only a fraction of a part.
    // Weight completeness explicitly so one generic curve cannot stand in for a cap,
    // an arm, or the object held in Gurumi's hand.
    const score = fBeta(precision, recall, 1) * Math.sqrt(recall);
    return { score, precision, recall };
  });

  const parts: Record<GurumiPartId, PartScore> = {
    body: featureScores.body,
    eyes: combineFeatureScores(
      featureScores,
      [{ id: "leftEye", weight: 0.5 }, { id: "rightEye", weight: 0.5 }],
      0.65,
    ),
    cap: combineFeatureScores(
      featureScores,
      [{ id: "capOuter", weight: 0.35 }, { id: "capDetail", weight: 0.65 }],
      0.25,
    ),
    raisedArm: combineFeatureScores(
      featureScores,
      [{ id: "raisedArmOuter", weight: 0.65 }, { id: "raisedArmInner", weight: 0.35 }],
      0.2,
    ),
    propHand: combineFeatureScores(
      featureScores,
      [{ id: "prop", weight: 0.5 }, { id: "holdingHand", weight: 0.5 }],
      0.45,
    ),
    face: combineFeatureScores(
      featureScores,
      [{ id: "nose", weight: 0.3 }, { id: "mouth", weight: 0.7 }],
      0.15,
    ),
    feet: combineFeatureScores(
      featureScores,
      [{ id: "leftFoot", weight: 0.5 }, { id: "lowerFoot", weight: 0.5 }],
      0.45,
    ),
  };

  const semantic =
    parts.body.score * 0.18 +
    parts.eyes.score * 0.22 +
    parts.cap.score * 0.14 +
    parts.raisedArm.score * 0.14 +
    parts.propHand.score * 0.14 +
    parts.face.score * 0.08 +
    parts.feet.score * 0.1;
  const globalLineScore = fBeta(alignment.precision, alignment.recall);
  const global = globalLineScore * 0.75 + alignment.structure * 0.25;
  const raw = semantic * 0.65 + global * 0.35;
  const poseCoverage = absoluteCellCoverage(userMask, reference.mask);
  const densityRatio = userInk / reference.pixelCount;
  const excessInkRatio = Math.max(0, densityRatio - 1.12);
  const densityFactor = Math.exp(-2.4 * excessInkRatio * excessInkRatio);
  const transformedPathLength = strokeAnalysis.strokeLength * alignment.transform.scale;
  const overdrawEfficiency = clamp(
    userInk / Math.max(1, transformedPathLength * 3 + strokeAnalysis.strokeCount * 5),
  );
  const overdrawFactor = 0.35 + 0.65 * smoothstep(0.25, 0.7, overdrawEfficiency);
  const directionFactor = 0.5 + 0.5 * smoothstep(0.25, 0.55, strokeAnalysis.orientationEntropy);
  const concentricRisk = strokeAnalysis.radialLoopCount >= 3
    ? smoothstep(0.45, 0.78, strokeAnalysis.angularMonotony) *
      smoothstep(1.5, 4.5, strokeAnalysis.radialLoopCount)
    : 0;
  const concentricFactor = 1 - 0.65 * concentricRisk;
  const spanWidth = userBounds.maxX - userBounds.minX;
  const spanHeight = userBounds.maxY - userBounds.minY;
  const spanFactor = clamp(Math.min(spanWidth / 0.32, spanHeight / 0.32));
  const lengthFactor = clamp(strokeAnalysis.strokeLength / 1.25);
  const effortFactor = Math.sqrt(spanFactor * lengthFactor);
  const base = Math.pow(clamp((raw - 0.1) / 0.78), 0.82);
  const penalized = base * densityFactor * overdrawFactor * directionFactor * concentricFactor * effortFactor;
  const signatureParts = [parts.cap, parts.raisedArm, parts.eyes, parts.propHand, parts.feet];
  const signatureQuality = signatureParts.reduce(
    (total, part) => total + smoothstep(0.28, 0.58, part.score),
    0,
  ) / signatureParts.length;
  let scoreCap = 99;

  const armPropQuality = Math.min(
    smoothstep(0.35, 0.58, parts.raisedArm.score),
    smoothstep(0.55, 0.78, parts.propHand.score),
  );
  const highScoreQuality = Math.min(
    smoothstep(0.45, 0.68, parts.eyes.score),
    smoothstep(0.42, 0.65, parts.cap.score),
    smoothstep(0.45, 0.68, parts.raisedArm.score),
    smoothstep(0.6, 0.8, parts.propHand.score),
    smoothstep(0.5, 0.72, globalLineScore),
  );
  scoreCap = Math.min(
    scoreCap,
    64 + 35 * smoothstep(0.3, 0.55, parts.eyes.score),
    59 + 40 * smoothstep(0.35, 0.85, signatureQuality),
    79 + 20 * smoothstep(0.28, 0.55, parts.cap.score),
    79 + 20 * armPropQuality,
    69 + 30 * smoothstep(0.25, 0.55, globalLineScore),
    59 + 40 * smoothstep(0.4, 0.7, poseCoverage),
    39 + 60 * smoothstep(0.2, 0.62, overdrawEfficiency),
    99 - 50 * smoothstep(1.45, 1.85, densityRatio),
    89 + 10 * highScoreQuality,
  );
  scoreCap = Math.min(scoreCap, 99 - 60 * concentricRisk);
  const directionRisk = smoothstep(0.65, 0.85, strokeAnalysis.dominantDirection) *
    (1 - smoothstep(0.2, 0.5, strokeAnalysis.orientationEntropy));
  scoreCap = Math.min(scoreCap, 99 - 50 * directionRisk);

  const calibrated = Math.min(0.99, scoreCap / 100, clamp(penalized));

  return {
    score: Math.round(calibrated * 100),
    calibrated,
    raw,
    semantic,
    global,
    precision: alignment.precision,
    recall: alignment.recall,
    structure: alignment.structure,
    unmatchedInk: unmatchedInkPixels / userInk,
    poseCoverage,
    densityRatio,
    overdrawEfficiency,
    orientationEntropy: strokeAnalysis.orientationEntropy,
    loopMonotony: strokeAnalysis.angularMonotony,
    dominantDirection: strokeAnalysis.dominantDirection,
    strokeLength: strokeAnalysis.strokeLength,
    scoreCap,
    parts,
  };
}

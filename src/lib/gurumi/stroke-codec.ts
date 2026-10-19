import {
  GURUMI_SCORE_GRID_SIZE,
  type Stroke,
} from "./similarity";

const COORDINATE_MAX = 65_534;
const STROKE_SEPARATOR = 65_535;
const MAX_ENCODED_LENGTH = 400_000;
export const GURUMI_MAX_POINT_COUNT = 8_000;
export const GURUMI_MAX_STROKE_COUNT = 400;
export const GURUMI_MAX_SCORING_WORK = 120_000;

function encodeBytes(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 16_384;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
}

function decodeBytes(encoded: string) {
  if (
    encoded.length > MAX_ENCODED_LENGTH ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    throw new Error("Invalid encoded stroke data.");
  }

  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function encodeStrokes(strokes: Stroke[]) {
  const coordinates: number[] = [];
  let pointCount = 0;
  let strokeCount = 0;

  for (const stroke of strokes) {
    let previousX = -1;
    let previousY = -1;
    let encodedPoint = false;

    for (const point of stroke.points) {
      const x = Math.round(Math.min(1, Math.max(0, point.x)) * COORDINATE_MAX);
      const y = Math.round(Math.min(1, Math.max(0, point.y)) * COORDINATE_MAX);
      if (x === previousX && y === previousY) continue;
      coordinates.push(x, y);
      previousX = x;
      previousY = y;
      pointCount += 1;
      encodedPoint = true;
    }

    if (encodedPoint) {
      coordinates.push(STROKE_SEPARATOR, STROKE_SEPARATOR);
      strokeCount += 1;
    }
  }

  if (pointCount > GURUMI_MAX_POINT_COUNT) {
    throw new Error("Drawing point count is outside the supported range.");
  }
  if (strokeCount > GURUMI_MAX_STROKE_COUNT) {
    throw new Error("Drawing stroke count is outside the supported range.");
  }

  const bytes = new Uint8Array(coordinates.length * 2);
  const view = new DataView(bytes.buffer);
  coordinates.forEach((coordinate, index) => {
    view.setUint16(index * 2, coordinate, false);
  });

  return { encoded: encodeBytes(bytes), pointCount };
}

export function decodeStrokes(encoded: string) {
  const bytes = decodeBytes(encoded);
  if (bytes.byteLength === 0) return { pointCount: 0, scoringWork: 0, strokes: [] };
  if (bytes.byteLength % 4 !== 0) throw new Error("Invalid stroke byte length.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const strokes: Stroke[] = [];
  let points: Stroke["points"] = [];
  let pointCount = 0;
  let pathLength = 0;
  const xCoordinates: number[] = [];
  const yCoordinates: number[] = [];

  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const x = view.getUint16(offset, false);
    const y = view.getUint16(offset + 2, false);
    const xIsSeparator = x === STROKE_SEPARATOR;
    const yIsSeparator = y === STROKE_SEPARATOR;

    if (xIsSeparator || yIsSeparator) {
      if (!xIsSeparator || !yIsSeparator || points.length === 0) {
        throw new Error("Invalid stroke separator.");
      }
      strokes.push({ points });
      points = [];
      if (strokes.length > GURUMI_MAX_STROKE_COUNT) {
        throw new Error("Drawing contains too many strokes.");
      }
      continue;
    }

    const point = { x: x / COORDINATE_MAX, y: y / COORDINATE_MAX };
    const previousPoint = points[points.length - 1];
    if (previousPoint) {
      pathLength += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
    }
    points.push(point);
    xCoordinates.push(point.x);
    yCoordinates.push(point.y);
    pointCount += 1;
    if (pointCount > GURUMI_MAX_POINT_COUNT) {
      throw new Error("Drawing contains too many points.");
    }
  }

  if (points.length > 0) throw new Error("Drawing is missing its final separator.");
  if (strokes.length === 0) throw new Error("Drawing does not contain any strokes.");

  xCoordinates.sort((first, second) => first - second);
  yCoordinates.sort((first, second) => first - second);
  const trim = pointCount >= 100 ? 0.01 : 0;
  const lowerIndex = Math.floor((pointCount - 1) * trim);
  const upperIndex = Math.ceil((pointCount - 1) * (1 - trim));
  const drawingSpan = Math.max(
    xCoordinates[upperIndex] - xCoordinates[lowerIndex],
    yCoordinates[upperIndex] - yCoordinates[lowerIndex],
    1 / GURUMI_SCORE_GRID_SIZE,
  );
  const scoringWork = Math.ceil(
    (pathLength / drawingSpan) * GURUMI_SCORE_GRID_SIZE,
  );
  if (scoringWork > GURUMI_MAX_SCORING_WORK) {
    throw new Error("Drawing contains too much segment work.");
  }

  return { pointCount, scoringWork, strokes };
}

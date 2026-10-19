import {
  createScoreRecord,
  isGurumiRecordId,
  normalizeGurumiName,
  type ScoreSubmission,
} from "@/lib/gurumi/records";
import { scoreGurumiDrawing } from "@/lib/gurumi/server-score";
import { decodeStrokes } from "@/lib/gurumi/stroke-codec";
import {
  GURUMI_EXPECTED_ROUND_DURATION_MS,
  readGurumiRoundSession,
  takeGurumiRateLimit,
} from "@/lib/gurumi/round-session";
import {
  findGurumiScore,
  listGurumiScores,
  saveGurumiScore,
} from "@/lib/gurumi/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};
const MAX_REQUEST_BYTES = 500_000;

class RequestTooLargeError extends Error {}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { headers: RESPONSE_HEADERS, status });
}

async function readJsonBody(request: Request) {
  if (!request.body) throw new SyntaxError("Request body is missing.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestTooLargeError("Request body is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function normalizeSubmission(value: unknown): ScoreSubmission | null {
  if (!value || typeof value !== "object") return null;
  const submission = value as Partial<ScoreSubmission>;
  const name = normalizeGurumiName(submission.name);

  if (
    !name ||
    !isGurumiRecordId(submission.id) ||
    typeof submission.roundToken !== "string" ||
    submission.roundToken.length === 0 ||
    submission.roundToken.length > 1_024 ||
    typeof submission.strokes !== "string"
  ) {
    return null;
  }

  return {
    id: submission.id,
    name,
    roundToken: submission.roundToken,
    strokes: submission.strokes,
  };
}

export async function GET() {
  try {
    return Response.json(
      { leaderboard: await listGurumiScores() },
      { headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    console.error("Failed to load the Gurumi leaderboard.", error);
    return errorResponse("랭킹을 불러오지 못했습니다.", 503);
  }
}

export async function POST(request: Request) {
  const rateLimit = takeGurumiRateLimit(request, "submission");
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      {
        headers: {
          ...RESPONSE_HEADERS,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
        status: 429,
      },
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("그림 데이터가 너무 큽니다.", 413);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return errorResponse("그림 데이터가 너무 큽니다.", 413);
    }
    return errorResponse("요청 형식이 올바르지 않습니다.", 400);
  }

  const submission = normalizeSubmission(body);
  if (!submission) return errorResponse("참가자 정보가 올바르지 않습니다.", 400);
  const roundSession = readGurumiRoundSession(submission.roundToken, submission.id);
  if (!roundSession) {
    return errorResponse("게임 참여 시간이 만료됐습니다. 새 게임을 시작해 주세요.", 401);
  }

  try {
    const existingRecord = await findGurumiScore(submission.id);
    if (existingRecord) {
      return Response.json(
        { leaderboard: await listGurumiScores(), record: existingRecord },
        { headers: RESPONSE_HEADERS, status: 200 },
      );
    }
  } catch (error) {
    console.error("Failed to check an existing Gurumi score.", error);
    return errorResponse("점수 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }

  let decoded: ReturnType<typeof decodeStrokes>;
  try {
    decoded = decodeStrokes(submission.strokes);
  } catch {
    return errorResponse("그림 좌표를 읽을 수 없습니다.", 400);
  }

  try {
    const score = await scoreGurumiDrawing(decoded.strokes);
    const candidate = createScoreRecord({
      id: submission.id,
      name: submission.name,
      score,
      createdAt: new Date(
        Math.min(Date.now(), roundSession.issuedAt + GURUMI_EXPECTED_ROUND_DURATION_MS),
      ).toISOString(),
    });
    const record = await saveGurumiScore({
      record: candidate,
      scoreDetails: score,
      strokes: submission.strokes,
      pointCount: decoded.pointCount,
    });
    const leaderboard = await listGurumiScores();

    return Response.json({ leaderboard, record }, { headers: RESPONSE_HEADERS, status: 201 });
  } catch (error) {
    console.error("Failed to save a Gurumi score.", error);
    return errorResponse("점수를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503);
  }
}

import {
  createGurumiRoundSession,
  takeGurumiRateLimit,
} from "@/lib/gurumi/round-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function POST(request: Request) {
  // A previously opened event page still has the old, fixed reference image.
  // Make it refresh rather than silently scoring against a different character.
  if (request.headers.get("x-gurumi-client") !== "krug-v1") {
    return Response.json({ error: "게임이 업데이트됐습니다. 새로고침 후 다시 시작해 주세요." },
      { headers: RESPONSE_HEADERS, status: 409 });
  }
  const rateLimit = takeGurumiRateLimit(request, "round");
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "잠시 후 다음 참가자를 시작해 주세요." },
      {
        headers: {
          ...RESPONSE_HEADERS,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
        status: 429,
      },
    );
  }

  try {
    return Response.json(createGurumiRoundSession(), {
      headers: RESPONSE_HEADERS,
      status: 201,
    });
  } catch (error) {
    console.error("Failed to prepare a Gurumi round.", error);
    return Response.json(
      { error: "게임을 준비하지 못했습니다. 운영진에게 알려주세요." },
      { headers: RESPONSE_HEADERS, status: 503 },
    );
  }
}

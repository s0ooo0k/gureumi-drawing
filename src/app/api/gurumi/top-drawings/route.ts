import { listGurumiTopDrawings } from "@/lib/gurumi/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

// Takes no id: only the server-computed top drawings are public.
export async function GET() {
  try {
    return Response.json({ drawings: await listGurumiTopDrawings() }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    console.error("Failed to load the Gurumi top drawings.", error);
    return Response.json({ error: "그림을 불러오지 못했습니다." }, { headers: RESPONSE_HEADERS, status: 503 });
  }
}

import { isGurumiAdminAuthenticated } from "@/lib/gurumi/admin-auth";
import { isGurumiRecordId } from "@/lib/gurumi/records";
import { findGurumiDrawing } from "@/lib/gurumi/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Keep this endpoint under /gurumi so the existing admin cookie is sent.
  if (!(await isGurumiAdminAuthenticated())) {
    return Response.json({ error: "관리자 로그인이 필요합니다. 화면을 닫고 다시 로그인해 주세요." }, { status: 401, headers });
  }
  const { id } = await params;
  if (!isGurumiRecordId(id)) {
    return Response.json({ error: "올바르지 않은 기록입니다." }, { status: 400, headers });
  }
  try {
    const drawing = await findGurumiDrawing(id);
    if (!drawing) {
      return Response.json({ error: "그림을 찾지 못했습니다. 기록이 삭제되었을 수 있습니다." }, { status: 404, headers });
    }
    return Response.json(drawing, { headers });
  } catch {
    return Response.json({ error: "그림을 불러오지 못했습니다. 다시 시도해 주세요." }, { status: 503, headers });
  }
}

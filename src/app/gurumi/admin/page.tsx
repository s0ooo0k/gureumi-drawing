import type { Metadata } from "next";

import { GurumiAdmin } from "@/components/gurumi/GurumiAdmin";
import { isGurumiAdminAuthenticated } from "@/lib/gurumi/admin-auth";
import type { ScoreRecord } from "@/lib/gurumi/records";
import { listGurumiScores } from "@/lib/gurumi/storage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "구르미 그리기 운영 | AUSGCON 2026",
  description: "AUSGCON 2026 구르미 그리기 부스 기록 관리",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function GurumiAdminPage() {
  const authenticated = await isGurumiAdminAuthenticated();
  let records: ScoreRecord[] = [];
  let initialError = "";

  if (authenticated) {
    try {
      records = await listGurumiScores();
    } catch {
      initialError = "기록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.";
    }
  }

  return (
    <GurumiAdmin
      initialAuthenticated={authenticated}
      initialError={initialError}
      initialRecords={records}
    />
  );
}

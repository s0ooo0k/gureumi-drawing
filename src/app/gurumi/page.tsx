import type { Metadata } from "next";

import { GurumiGame } from "@/components/gurumi/GurumiGame";

export const metadata: Metadata = {
  title: "구르미 그리기 | AUSGCON 2026",
  description: "30초 동안 AUSG 구르미를 그리고 닮은꼴 점수로 순위에 도전하세요.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function GurumiPage() {
  return <GurumiGame />;
}

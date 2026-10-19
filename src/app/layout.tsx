import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "구르미 그리기",
  description: "30초 동안 구르미를 그리고 닮은꼴 점수로 순위에 도전하세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}

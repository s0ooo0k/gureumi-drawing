export const GURUMI_CHARACTERS = [
  { id: "ai-engineering", name: "AI Engineering", group: "AI 엔지니어링 소모임" },
  { id: "architecture", name: "Architecture", group: "아키텍처 소모임" },
  { id: "beginners", name: "Beginners", group: "비기너 소모임" },
  { id: "busan", name: "Busan", group: "부산 소모임" },
  { id: "cert", name: "Certification", group: "자격증 소모임" },
  { id: "container", name: "Container", group: "컨테이너 소모임" },
  { id: "data", name: "Data", group: "데이터 소모임" },
  { id: "devops", name: "DevOps", group: "DevOps 소모임" },
  { id: "euljiro", name: "Euljiro", group: "을지로 소모임" },
  { id: "gametech", name: "GameTech", group: "게임테크 소모임" },
  { id: "magok", name: "Magok", group: "마곡 소모임" },
  { id: "serverless", name: "Serverless", group: "서버리스 소모임" },
  { id: "women-in-cloud", name: "Women in Cloud", group: "Women in Cloud 소모임" },
] as const;
export type GurumiCharacterId = (typeof GURUMI_CHARACTERS)[number]["id"];
export function isGurumiCharacterId(value: unknown): value is GurumiCharacterId {
  return GURUMI_CHARACTERS.some((character) => character.id === value);
}
export function getGurumiCharacter(id: string | undefined) {
  return GURUMI_CHARACTERS.find((character) => character.id === id);
}
export function characterImage(id: string | undefined) {
  return getGurumiCharacter(id) ? `/assets/krug/${id}_TP.png` : "/assets/ausgcon/gurumi/reference.png";
}
export function characterLabel(id: string | undefined) {
  return getGurumiCharacter(id)?.group ?? "이전 행사 구르미";
}

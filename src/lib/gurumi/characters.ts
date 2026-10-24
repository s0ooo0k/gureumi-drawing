export const GURUMI_CHARACTERS = [
  { id: "ai-engineering", name: "AI Engineering", group: "AI 엔지니어링 소모임", description: "AI 아이디어를 실제 서비스로 만드는 경험을 함께 나눠요." },
  { id: "architecture", name: "Architecture", group: "아키텍처 소모임", description: "더 나은 클라우드 설계를 고민하고 경험을 나눠요." },
  { id: "beginners", name: "Beginners", group: "비기너 소모임", description: "AWS가 처음이어도 괜찮아요. 기초부터 함께 배워요." },
  { id: "busan", name: "Busan", group: "부산 소모임", description: "부산에서 클라우드 이야기와 새로운 인연을 만나요." },
  { id: "cert", name: "Certification", group: "자격증 소모임", description: "AWS 자격증 공부와 실무 지식을 함께 쌓아요." },
  { id: "container", name: "Container", group: "컨테이너 소모임", description: "컨테이너와 Kubernetes로 서비스 운영을 탐구해요." },
  { id: "data", name: "Data", group: "데이터 소모임", description: "데이터를 모으고 분석해 새로운 가치를 찾아요." },
  { id: "devops", name: "DevOps", group: "DevOps 소모임", description: "개발과 운영을 잇는 자동화와 협업을 이야기해요." },
  { id: "euljiro", name: "Euljiro", group: "을지로 소모임", description: "을지로에서 가볍게 만나 클라우드 경험을 나눠요." },
  { id: "gametech", name: "GameTech", group: "게임테크 소모임", description: "게임을 만드는 기술과 클라우드 운영을 함께 알아가요." },
  { id: "magok", name: "Magok", group: "마곡 소모임", description: "마곡에서 만나 클라우드 기술과 경험을 나눠요." },
  { id: "serverless", name: "Serverless", group: "서버리스 소모임", description: "서버 관리의 부담을 줄이고 서비스 만들기에 집중해요." },
  { id: "women-in-cloud", name: "Women in Cloud", group: "Women in Cloud 소모임", description: "클라우드에서 성장하는 여성들의 경험과 응원을 나눠요." },
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

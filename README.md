# 구르미 그리기

30초 동안 구르미를 따라 그리고 닮은꼴 점수로 순위에 도전하는 Next.js 게임입니다.
AUSGCON 사이트에서 게임만 분리하고 Turso 저장 계층을 Supabase Postgres로 교체했습니다.

## 실행

Node.js 22 이상을 사용합니다.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

- `/`: 게임 (기존 `/gurumi` 주소도 유지)
- `/gurumi/admin`: 관리자 로그인, 기록 수정·삭제, 그림 조회, 시상 화면
- `/api/gurumi/round`, `/api/gurumi/scores`: 라운드 발급 및 점수 API

## Supabase 설정

1. 개인 Supabase 프로젝트를 생성합니다.
2. SQL Editor에서 `supabase/migrations/20261019000000_create_gurumi_scores.sql`을 실행합니다.
3. 프로젝트 URL과 Secret key를 `.env.local`의 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`에 설정합니다. 구형 `service_role` 키는 `SUPABASE_SERVICE_ROLE_KEY`로도 지원합니다.
4. `openssl rand -hex 32`로 `GURUMI_ROUND_SECRET`, `GURUMI_ADMIN_SESSION_SECRET`을 각각 생성하고 관리자 비밀번호를 설정합니다.

키와 비밀번호는 서버에서만 사용합니다. 테이블은 RLS를 활성화하고 브라우저 역할의 접근을 차단합니다. 랭킹 조회와 제출은 Next.js 서버를 거치고, 그림 원본 조회·수정·삭제는 관리자 인증이 필요합니다.

## Vercel 배포

1. 개인 Vercel 계정에서 이 GitHub 저장소를 Import합니다.
2. Framework는 Next.js, Node.js는 22 이상으로 선택합니다. 기본 빌드 명령은 `npm run build`입니다.
3. `.env.example`의 환경변수 다섯 개를 Vercel에 등록하고 배포합니다.
4. 게임 한 판을 마친 뒤 랭킹 저장과 관리자 그림 조회를 확인합니다.

Production과 Preview에 서로 다른 Supabase 프로젝트 및 서명 비밀값을 사용하면 개발 중 운영 기록 변경을 방지할 수 있습니다. 기준 이미지의 서버 채점을 위해 Next.js output tracing에 원본 PNG를 포함합니다.

## 검증

```sh
npm run lint
npm run typecheck
npm run test:gurumi
npm run test:storage
npm run build
```

채점·서명·관리자 그림 접근 회귀 테스트와 저장 계층 테스트는 외부 서비스 없이 실행됩니다. 실제 Supabase 연결은 프로젝트 환경변수와 마이그레이션 적용 후 별도 확인해야 합니다. 2026-10-19 기준 `npm audit --omit=dev`는 취약점 0건이며, 전체 audit에는 ESLint의 braces 의존성 경로에 high 항목 5건이 남아 있습니다. 원본의 메모리 기반 요청 제한은 Vercel 인스턴스마다 적용되므로 전역 제한을 보장하지 않습니다. 네트워크 장애 시 그림은 브라우저에 임시 보관하고 재전송합니다.

## 출처

원본: https://github.com/AUSG/ausgcon2026

추출 기준 커밋: `e403f4d389c4b2e3d5e45c424c55b716a990b27e`.
원본의 게임 코드, 구르미 이미지와 폰트를 포함하며 저작권과 자산 권리는 원저작자에게 있습니다. 원본에 라이선스 파일이 없어 별도 오픈소스 라이선스를 추가하지 않았습니다. 기존 행사 DB와 참가자 기록은 복사하지 않습니다.

설정 참고: [Supabase API 키](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase upsert](https://supabase.com/docs/reference/javascript/upsert), [Vercel Next.js 배포](https://vercel.com/docs/frameworks/full-stack/nextjs).

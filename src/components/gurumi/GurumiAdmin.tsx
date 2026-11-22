"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import {
  deleteGurumiAdminRecord,
  loginGurumiAdmin,
  logoutGurumiAdmin,
  refreshGurumiAdminRecords,
  setGurumiAdminGiftMinimumScore,
  setGurumiAdminGiftReceived,
  updateGurumiAdminRecord,
  type GurumiAdminActionResult,
} from "@/app/gurumi/admin/actions";
import { characterLabel } from "@/lib/gurumi/characters";
import {
  GURUMI_DEFAULT_GIFT_MIN_SCORE,
  isGurumiGiftMinimumScore,
  qualifiesForGurumiGift,
  type AdminScoreRecord,
  type GurumiAdminData,
  type ScoreRecord,
} from "@/lib/gurumi/records";
import { GURUMI_SCORE_VERSION } from "@/lib/gurumi/similarity";

import styles from "./GurumiAdmin.module.css";
import { GurumiAwards } from "./GurumiAwards";

const PAGE_SIZE = 50;

type RecordDraft = {
  name: string;
  score: string;
};

function draftsFromRecords(records: ScoreRecord[]) {
  return Object.fromEntries(
    records.map((record) => [record.id, { name: record.name, score: String(record.score) }]),
  ) as Record<string, RecordDraft>;
}

function formatRecordedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function GurumiAdmin({
  initialAuthenticated,
  initialError,
  initialData,
}: {
  initialAuthenticated: boolean;
  initialError: string;
  initialData: GurumiAdminData | null;
}) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [data, setData] = useState(initialData);
  const [drafts, setDrafts] = useState(() => draftsFromRecords(initialData?.records ?? []));
  const [minimumScoreDraft, setMinimumScoreDraft] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [giftFilter, setGiftFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialError);
  const [noticeKind, setNoticeKind] = useState<"error" | "success">(
    initialError ? "error" : "success",
  );
  const [isPending, startTransition] = useTransition();
  const [awardIndex, setAwardIndex] = useState<number | null>(null);

  const records = data?.records ?? [];
  const minimumScore = data?.giftMinimumScore ?? GURUMI_DEFAULT_GIFT_MIN_SCORE;
  const draftMinimum = Number(minimumScoreDraft ?? minimumScore);
  const rankedRecords = useMemo(
    () => data?.records.map((record, index) => ({ rank: index + 1, record })) ?? [],
    [data],
  );
  const currentScores = useMemo(
    () => data?.records.filter((record) => record.scoreVersion === GURUMI_SCORE_VERSION) ?? [],
    [data],
  );
  const giftCount = currentScores.filter((record) => qualifiesForGurumiGift(record, minimumScore)).length;
  const eligibleRate = currentScores.length ? Math.round((100 * giftCount) / currentScores.length) : 0;
  const draftGiftCount = currentScores.filter((record) => qualifiesForGurumiGift(record, draftMinimum)).length;
  const brackets = Array.from({ length: 10 }, (_, index) => ({
    min: Math.max(1, index * 10),
    max: index === 9 ? 100 : index * 10 + 9,
    eligible: 0,
    below: 0,
  }));
  let zeroScores = 0;
  for (const record of currentScores) {
    if (record.score === 0) {
      zeroScores += 1;
    } else {
      const bracket = brackets[Math.min(9, Math.floor(record.score / 10))];
      if (qualifiesForGurumiGift(record, minimumScore)) bracket.eligible += 1;
      else bracket.below += 1;
    }
  }
  const largestBracket = Math.max(1, ...brackets.map(({ eligible, below }) => eligible + below));
  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
    return rankedRecords.filter(({ record }) => {
      const eligible = qualifiesForGurumiGift(record, minimumScore);
      if (giftFilter === "received" && !record.giftReceived) return false;
      if (giftFilter === "eligible" && !eligible) return false;
      if (giftFilter === "waiting" && (!eligible || record.giftReceived)) return false;
      return `${record.name} ${record.id}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery);
    });
  }, [giftFilter, minimumScore, query, rankedRecords]);
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRecords = filteredRecords.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const handleResult = (result: GurumiAdminActionResult, { keepDrafts = false } = {}) => {
    if (!result.ok) {
      setNotice(result.error);
      setNoticeKind("error");
      if (result.unauthorized) {
        setAuthenticated(false);
        setData(null);
        setDrafts({});
      }
      return false;
    }
    setData(result.data);
    setDrafts((current) => {
      const next = draftsFromRecords(result.data.records);
      if (keepDrafts) {
        for (const record of data?.records ?? []) {
          const draft = current[record.id];
          if (next[record.id] && draft && (draft.name !== record.name || draft.score !== String(record.score))) {
            next[record.id] = draft;
          }
        }
      }
      return next;
    });
    setNotice(result.message ?? "최신 기록을 불러왔습니다.");
    setNoticeKind("success");
    return true;
  };

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("");
    startTransition(async () => {
      const result = await loginGurumiAdmin(password);
      if (handleResult(result)) {
        setAuthenticated(true);
        setPassword("");
      }
    });
  };

  const handleLogout = () => {
    startTransition(async () => {
      await logoutGurumiAdmin();
      setAuthenticated(false);
      setData(null);
      setDrafts({});
      setMinimumScoreDraft(null);
      setNotice("");
    });
  };

  const handleRefresh = () => {
    setNotice("");
    startTransition(async () => {
      handleResult(await refreshGurumiAdminRecords());
    });
  };

  const saveMinimumScore = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isGurumiGiftMinimumScore(draftMinimum)) return;
    setNotice("");
    startTransition(async () => {
      if (handleResult(await setGurumiAdminGiftMinimumScore(draftMinimum), { keepDrafts: true })) {
        setMinimumScoreDraft(null);
      }
    });
  };

  const toggleGiftReceived = (record: AdminScoreRecord) => {
    setBusyRecordId(record.id);
    setNotice("");
    startTransition(async () => {
      handleResult(await setGurumiAdminGiftReceived(record.id, !record.giftReceived), { keepDrafts: true });
      setBusyRecordId(null);
    });
  };

  const updateDraft = (id: string, patch: Partial<RecordDraft>) => {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  };

  const saveRecord = (record: ScoreRecord) => {
    const draft = drafts[record.id];
    if (!draft) return;
    setBusyRecordId(record.id);
    setNotice("");
    startTransition(async () => {
      const result = await updateGurumiAdminRecord({
        id: record.id,
        name: draft.name,
        score: Number(draft.score),
      });
      handleResult(result);
      setBusyRecordId(null);
    });
  };

  const removeRecord = (record: AdminScoreRecord) => {
    const receiptNote = record.giftReceived ? "\n이 기록의 선물 지급 1건도 집계에서 빠집니다." : "";
    if (!window.confirm(`‘${record.name}’의 ${record.score}점 기록을 삭제할까요?\n삭제 후 복구할 수 없습니다.${receiptNote}`)) {
      return;
    }
    setBusyRecordId(record.id);
    setNotice("");
    startTransition(async () => {
      const result = await deleteGurumiAdminRecord(record.id);
      handleResult(result);
      setBusyRecordId(null);
    });
  };

  return (
    <main className={styles.page}>
      <div className={styles.gridBackdrop} aria-hidden="true" />
      <header className={styles.header}>
        <Link href="/gurumi" aria-label="구르미 그리기 화면으로 이동">
          AWS Community Day <span>2026</span>
        </Link>
        <div>
          <span>BOOTH 03</span>
          <strong>ADMIN</strong>
        </div>
      </header>

      {!authenticated ? (
        <section className={styles.loginSection}>
          <div className={styles.loginCard}>
            <p>OPERATOR ACCESS</p>
            <h1>구르미 기록 관리</h1>
            <span>운영진 비밀번호를 입력해 주세요.</span>
            <form onSubmit={handleLogin}>
              <label htmlFor="gurumi-admin-password">비밀번호</label>
              <input
                autoComplete="current-password"
                autoFocus
                id="gurumi-admin-password"
                inputMode="numeric"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••"
                type="password"
                value={password}
              />
              <button disabled={isPending || password.length === 0} type="submit">
                {isPending ? "확인 중…" : "관리 화면 열기"}
                <span aria-hidden="true">→</span>
              </button>
            </form>
            {notice && <p className={styles.loginError} role="alert">{notice}</p>}
          </div>
        </section>
      ) : (
        <div className={styles.dashboard}>
          <section className={styles.dashboardHeading}>
            <div>
              <p>GURUMI RECORDS</p>
              <h1>참가 기록 관리</h1>
              <span>닉네임과 표시 점수를 수정하거나 잘못 등록된 기록을 삭제할 수 있습니다.</span>
            </div>
            <div className={styles.summary}>
              <span>TOTAL RECORDS</span>
              <strong>{records.length.toLocaleString("ko-KR")}</strong>
              <small>건</small>
            </div>
          </section>

          {data && (
            <section className={styles.giftPanel} aria-labelledby="gift-panel-title">
              <div className={styles.giftHeading}>
                <div>
                  <h2 id="gift-panel-title">선물 운영</h2>
                  <p>현재 채점 기록 {currentScores.length}건 중 기준 충족 <strong>{giftCount}건 ({eligibleRate}%)</strong></p>
                </div>
                <p className={styles.giftTotal}>지급 완료 <strong>{data.giftReceivedCount.toLocaleString("ko-KR")}건</strong></p>
              </div>
              <form className={styles.giftSettings} onSubmit={saveMinimumScore}>
                <label htmlFor="gift-minimum-score">선물 기준 점수</label>
                <input
                  id="gift-minimum-score"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  required
                  disabled={isPending}
                  value={minimumScoreDraft ?? minimumScore}
                  onChange={(event) => setMinimumScoreDraft(event.target.value)}
                />
                <button disabled={isPending || draftMinimum === minimumScore || !isGurumiGiftMinimumScore(draftMinimum)} type="submit">
                  기준 저장
                </button>
                {isGurumiGiftMinimumScore(draftMinimum) && draftMinimum !== minimumScore && (
                  <span role="status">{draftMinimum}점 이상 {draftGiftCount}건</span>
                )}
              </form>
              <figure className={styles.distribution}>
                <figcaption>점수 분포 <span>기준 충족</span>{zeroScores > 0 && <small>0점 {zeroScores}건</small>}</figcaption>
                <ol aria-label="1점부터 100점까지 구간별 기록 수">
                  {brackets.map(({ min, max, eligible, below }) => (
                    <li key={min} aria-label={`${min}~${max}점 ${eligible + below}건, 기준 충족 ${eligible}건`}>
                      <strong aria-hidden="true">{eligible + below}</strong>
                      <div className={styles.distributionTrack} aria-hidden="true">
                        <span style={{ height: `${(100 * eligible) / largestBracket}%` }} data-eligible="true" />
                        <span style={{ height: `${(100 * below) / largestBracket}%` }} />
                      </div>
                      <small aria-hidden="true">{min}–{max}</small>
                    </li>
                  ))}
                </ol>
              </figure>
            </section>
          )}

          <section className={styles.toolbar} aria-label="기록 검색 및 관리 도구">
            <label>
              <span>SEARCH</span>
              <input
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="닉네임 또는 기록 ID 검색"
                type="search"
                value={query}
              />
            </label>
            <div>
              <label className={styles.giftFilter}>
                <span>선물 상태</span>
                <select
                  value={giftFilter}
                  onChange={(event) => {
                    setGiftFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">모든 기록</option>
                  <option value="eligible">현재 기준 충족</option>
                  <option value="waiting">기준 충족 · 지급 대기</option>
                  <option value="received">지급 완료</option>
                </select>
              </label>
              <button disabled={isPending || records.length === 0} onClick={() => setAwardIndex(0)} type="button">시상 화면 (1위부터)</button>
              <button disabled={isPending} onClick={handleRefresh} type="button">새로고침</button>
              <button disabled={isPending} onClick={handleLogout} type="button">로그아웃</button>
            </div>
          </section>

          {notice && (
            <div className={styles.notice} data-kind={noticeKind} role={noticeKind === "error" ? "alert" : "status"}>
              {notice}
            </div>
          )}

          <section className={styles.recordsPanel} aria-label="구르미 참가 기록">
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th>순위</th>
                    <th>닉네임</th>
                    <th>점수</th>
                    <th>선물</th>
                    <th>기록 시각</th>
                    <th>기록 ID</th>
                    <th><span className={styles.visuallyHidden}>관리</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map(({ rank, record }) => {
                    const draft = drafts[record.id] ?? {
                      name: record.name,
                      score: String(record.score),
                    };
                    const dirty = draft.name !== record.name || draft.score !== String(record.score);
                    const busy = busyRecordId === record.id;
                    return (
                      <tr data-dirty={dirty ? "true" : undefined} key={record.id}>
                        <td><b>{String(rank).padStart(3, "0")}</b></td>
                        <td>
                          <label className={styles.visuallyHidden} htmlFor={`name-${record.id}`}>
                            {record.name} 닉네임
                          </label>
                          <input
                            id={`name-${record.id}`}
                            onChange={(event) => updateDraft(record.id, { name: event.target.value })}
                            value={draft.name}
                          />
                        </td>
                        <td>
                          <label className={styles.visuallyHidden} htmlFor={`score-${record.id}`}>
                            {record.name} 점수
                          </label>
                          <input
                            id={`score-${record.id}`}
                            max={100}
                            min={0}
                            onChange={(event) => updateDraft(record.id, { score: event.target.value })}
                            type="number"
                            value={draft.score}
                          />
                        </td>
                        <td>
                          <button
                            aria-label={`${record.name} 선물 지급`}
                            aria-pressed={record.giftReceived}
                            className={styles.giftCheck}
                            disabled={isPending || busy}
                            onClick={() => toggleGiftReceived(record)}
                            type="button"
                          >
                            {record.giftReceived ? "지급 완료" : "지급 체크"}
                          </button>
                          {qualifiesForGurumiGift(record, minimumScore) && <small>기준 충족</small>}
                        </td>
                        <td><small>{characterLabel(record.characterId)} · {record.scoreVersion}</small><br />{formatRecordedAt(record.createdAt)}</td>
                        <td><code title={record.id}>{record.id.slice(0, 8)}</code></td>
                        <td>
                          <div className={styles.rowActions}>
                            <button disabled={isPending} onClick={() => setAwardIndex(rank - 1)} type="button">그림 보기</button>
                            <button
                              disabled={!dirty || isPending || busy}
                              onClick={() => saveRecord(record)}
                              type="button"
                            >
                              저장
                            </button>
                            <button
                              disabled={isPending || busy}
                              onClick={() => removeRecord(record)}
                              type="button"
                            >
                              삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {visibleRecords.length === 0 && (
              <div className={styles.emptyState}>
                <strong>{records.length === 0 ? "아직 등록된 기록이 없습니다." : "조건에 맞는 기록이 없습니다."}</strong>
              </div>
            )}

            <footer className={styles.pagination}>
              <span>
                {filteredRecords.length.toLocaleString("ko-KR")}건 · {currentPage}/{totalPages} 페이지
              </span>
              <div>
                <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} type="button">이전</button>
                <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)} type="button">다음</button>
              </div>
            </footer>
          </section>

          <p className={styles.dataNote}>
            점수를 수정해도 참가자가 그린 선 좌표와 자동 채점 상세값은 그대로 보존됩니다.
          </p>
        </div>
      )}
      {authenticated && awardIndex !== null && records[awardIndex] && (
        <GurumiAwards records={records} initialIndex={awardIndex} onClose={() => setAwardIndex(null)} />
      )}
    </main>
  );
}

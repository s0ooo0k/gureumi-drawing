"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import {
  deleteGurumiAdminRecord,
  loginGurumiAdmin,
  logoutGurumiAdmin,
  refreshGurumiAdminRecords,
  updateGurumiAdminRecord,
  type GurumiAdminActionResult,
} from "@/app/gurumi/admin/actions";
import type { ScoreRecord } from "@/lib/gurumi/records";

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
  initialRecords,
}: {
  initialAuthenticated: boolean;
  initialError: string;
  initialRecords: ScoreRecord[];
}) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [records, setRecords] = useState(initialRecords);
  const [drafts, setDrafts] = useState(() => draftsFromRecords(initialRecords));
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialError);
  const [noticeKind, setNoticeKind] = useState<"error" | "success">(
    initialError ? "error" : "success",
  );
  const [isPending, startTransition] = useTransition();
  const [awardIndex, setAwardIndex] = useState<number | null>(null);

  const rankedRecords = useMemo(
    () => records.map((record, index) => ({ rank: index + 1, record })),
    [records],
  );
  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
    if (!normalizedQuery) return rankedRecords;
    return rankedRecords.filter(({ record }) =>
      `${record.name} ${record.id}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery),
    );
  }, [query, rankedRecords]);
  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRecords = filteredRecords.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const replaceRecords = (nextRecords: ScoreRecord[]) => {
    setRecords(nextRecords);
    setDrafts(draftsFromRecords(nextRecords));
  };

  const handleResult = (result: GurumiAdminActionResult) => {
    if (!result.ok) {
      setNotice(result.error);
      setNoticeKind("error");
      if (result.unauthorized) {
        setAuthenticated(false);
        setRecords([]);
        setDrafts({});
      }
      return false;
    }
    replaceRecords(result.records);
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
      setRecords([]);
      setDrafts({});
      setNotice("");
    });
  };

  const handleRefresh = () => {
    setNotice("");
    startTransition(async () => {
      handleResult(await refreshGurumiAdminRecords());
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

  const removeRecord = (record: ScoreRecord) => {
    if (!window.confirm(`‘${record.name}’의 ${record.score}점 기록을 삭제할까요?\n삭제 후 복구할 수 없습니다.`)) {
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
          AUSGCON <span>2026</span>
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
                        <td>{formatRecordedAt(record.createdAt)}</td>
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
                <strong>{records.length === 0 ? "아직 등록된 기록이 없습니다." : "검색 결과가 없습니다."}</strong>
                <span>{records.length === 0 ? "참가자의 첫 기록을 기다리고 있어요." : "검색어를 바꿔보세요."}</span>
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

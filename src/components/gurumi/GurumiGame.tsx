"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  buildGurumiReferenceModel,
  ADAPTIVE_PART_IDS,
  GURUMI_SCORE_GRID_SIZE,
  GURUMI_SCORE_VERSION,
  scoreDrawing,
  type GurumiReferenceModel,
} from "@/lib/gurumi/similarity";
import {
  createScoreRecord,
  GURUMI_LEADERBOARD_LIMIT,
  isGurumiRoundSession,
  isLeaderboardResponse,
  isScoreRecord,
  isScoreSubmissionResponse,
  normalizeGurumiName,
  sortRecords,
  type GurumiRoundSession,
  type PendingScore,
  type ScoreRecord,
  type ScoreSubmission,
  type ScoreSubmissionResponse,
} from "@/lib/gurumi/records";
import {
  deletePendingGurumiScore,
  listPendingGurumiScores,
  savePendingGurumiScore,
} from "@/lib/gurumi/offline-store";
import { encodeStrokes } from "@/lib/gurumi/stroke-codec";

import { DrawingCanvas, type DrawingCanvasHandle } from "./DrawingCanvas";
import styles from "./GurumiGame.module.css";

import { GURUMI_CHARACTERS, characterImage, characterLabel, getGurumiCharacter } from "@/lib/gurumi/characters";
const SCORE_STORAGE_KEY = "ausgcon-2026-gurumi-scores-semantic-v2";
const ROUND_DURATION = 30_000;
const LEADERBOARD_REFRESH_INTERVAL = 10_000;

const PART_LABELS: Record<string, string> = {
  upperLeft: "왼쪽 위", upperCenter: "가운데 위", upperRight: "오른쪽 위",
  middleLeft: "왼쪽 중앙", middleCenter: "가운데", middleRight: "오른쪽 중앙",
  lowerLeft: "왼쪽 아래", lowerCenter: "가운데 아래", lowerRight: "오른쪽 아래",
};
type Phase = "intro" | "reveal" | "countdown" | "drawing" | "scoring" | "result";

async function loadReferenceModel(src: string): Promise<GurumiReferenceModel> {
  const image = new window.Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("구르미 이미지를 불러오지 못했습니다. 다시 시도해 주세요.")), 12_000);
    image.onload = () => { window.clearTimeout(timeout); resolve(); };
    image.onerror = () => { window.clearTimeout(timeout); reject(new Error("구르미 이미지를 불러오지 못했습니다. 다시 시도해 주세요.")); };
    image.src = src;
  });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = GURUMI_SCORE_GRID_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("그리기를 지원하는 브라우저로 다시 접속해 주세요.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return buildGurumiReferenceModel(context.getImageData(0, 0, canvas.width, canvas.height), "adaptive");
}
type StorageMode = "loading" | "live" | "saving" | "offline";

function readCachedRecords() {
  try {
    const stored = window.localStorage.getItem(SCORE_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? sortRecords(parsed.filter(isScoreRecord).filter(record => record.scoreVersion === GURUMI_SCORE_VERSION)).slice(0, GURUMI_LEADERBOARD_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function mergeRecords(serverRecords: ScoreRecord[], pendingScores: PendingScore[]) {
  const recordsById = new Map<string, ScoreRecord>();
  for (const pending of pendingScores) recordsById.set(pending.record.id, pending.record);
  for (const record of serverRecords) recordsById.set(record.id, record);
  return sortRecords([...recordsById.values()].filter(record => record.scoreVersion === GURUMI_SCORE_VERSION)).slice(0, GURUMI_LEADERBOARD_LIMIT);
}

async function fetchJsonWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      if (response.ok || controller.signal.aborted) throw error;
    }
    return { body, response };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function loadServerLeaderboard() {
  const { body, response } = await fetchJsonWithTimeout("/api/gurumi/scores", {
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Leaderboard request failed.");
  if (!isLeaderboardResponse(body)) throw new Error("Leaderboard response is invalid.");
  return body.leaderboard;
}

class ScoreSubmissionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number,
  ) {
    super(message);
  }
}

function responseErrorMessage(body: unknown, fallback: string) {
  if (
    body &&
    typeof body === "object" &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  return fallback;
}

async function prepareRound() {
  const { body, response } = await fetchJsonWithTimeout("/api/gurumi/round", {
    headers: { "X-Gurumi-Client": "krug-v1" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, "게임을 준비하지 못했습니다."));
  }
  if (!isGurumiRoundSession(body)) throw new Error("게임 준비 응답이 올바르지 않습니다.");
  return body;
}

async function submitScore(submission: ScoreSubmission): Promise<ScoreSubmissionResponse> {
  const { body, response } = await fetchJsonWithTimeout("/api/gurumi/scores", {
    body: JSON.stringify(submission),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new ScoreSubmissionError(
      responseErrorMessage(body, "점수를 저장하지 못했습니다."),
      response.status === 408 || response.status === 429 || response.status >= 500,
      response.status,
    );
  }
  if (!isScoreSubmissionResponse(body)) throw new Error("Score response is invalid.");
  return body;
}

function resultMessage(score: number) {
  if (score >= 90) return "구르미 그 자체!";
  if (score >= 75) return "구르미 마스터!";
  if (score >= 55) return "제법 닮았구름!";
  if (score >= 30) return "상상력이 피어났구름!";
  return "30초의 용기가 멋져요!";
}

function SketchbookDecor() {
  return <div className={styles.gridBackdrop} aria-hidden="true">
    <svg className={styles.textureDefinitions} width="0" height="0"><defs>
      <filter id="crayon-edge" x="-15%" y="-15%" width="130%" height="130%">
        <feTurbulence type="fractalNoise" baseFrequency=".12" numOctaves="3" seed="8" result="grain" />
        <feDisplacementMap in="SourceGraphic" in2="grain" scale="3" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs></svg>
    <svg className={styles.doodleSun} viewBox="0 0 160 160" fill="none"><g filter="url(#crayon-edge)" stroke="#e1b443" strokeLinecap="round" strokeLinejoin="round">
      <path d="M51 58c-15 27 9 58 37 49 30-9 31-46 8-58-25-13-42-1-45 22 0 26 33 40 48 16" strokeWidth="5"/>
      <path d="m61 65 12-12-15 30 30-32-28 44 39-36-26 42 32-29-17 29" strokeWidth="5"/>
      <path d="m76 31-4-21m32 29 13-22m6 40 25-9m-20 34 23 4m-37 20 15 18m-40-6 4 28m-30-32-12 24m-1-47-24 11m21-34L8 67m36-17L26 30" strokeWidth="5"/>
    </g></svg>
    <div className={styles.spiralBinding}>{Array.from({ length: 18 }, (_, index) => <i key={index} />)}</div>
    <svg className={styles.doodleStar} viewBox="0 0 100 100" fill="none"><g filter="url(#crayon-edge)"><path d="M49 9 61 35 90 38 65 56 73 85 49 67 24 84 32 54 9 36 39 37Z" fill="#e1ecff" stroke="currentColor" strokeWidth="4" strokeLinejoin="round"/><path d="m43 32 8-12-9 30 15-19-16 32 25-25-17 26 16-13M79 10l4-6m8 20 8-2M8 74l-6 4" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></g></svg>
    <svg className={styles.doodleClouds} viewBox="0 0 240 130" fill="none"><g filter="url(#crayon-edge)" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 66C3 64 5 43 24 43 16 19 47 14 59 29 76 6 111 22 108 40 140 36 145 66 121 70 89 77 49 73 20 66Z" strokeWidth="4"/>
      <path d="m24 51 18-23-14 33 29-34-19 37 34-39-24 40 39-36-25 38 35-29-19 32 28-23-13 23 23-16" strokeWidth="2.5"/>
      <path d="M154 112c-19-4-17-22 1-25-1-18 22-25 32-10 17-17 37-2 32 13 23 7 16 24 1 25-24 4-48 2-66-3Z" strokeWidth="3"/>
      <path d="m156 100 10-13-6 21 23-28-14 29 27-25-16 28 27-21-16 21 28-14-10 14" strokeWidth="2"/>
    </g></svg>
    <svg className={styles.doodlePencil} viewBox="0 0 160 90" fill="none"><path d="m18 61 15-23 97-20 8 28-97 22Z" fill="#d8e9ff" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><path d="m33 38 8 30m-23-7 11 2m10-10 93-20M13 78c23 8 39-12 65-2s40 0 61-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
  </div>;
}

function KioskHeader() {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="구르미 그리기 홈으로 이동">
        AWS Community Day <span>2026</span>
      </Link>
      <div className={styles.boothId}>
        <span>BOOTH</span>
        <strong>03</strong>
      </div>
    </header>
  );
}

const STORAGE_STATUS_LABEL: Record<StorageMode, string> = {
  loading: "CONNECTING",
  live: "온라인",
  saving: "SAVING",
  offline: "LOCAL BACKUP",
};

function FullLeaderboard({
  open,
  records,
  storageMode,
  onClose,
  highlightId,
}: {
  open: boolean;
  records: ScoreRecord[];
  storageMode: StorageMode;
  onClose: () => void;
  highlightId?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={headingId}
      className={styles.fullRankingDialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onClose={onClose}
      ref={dialogRef}
    >
      <div className={styles.fullRankingBoard}>
        <header className={styles.fullRankingHeader}>
          <div>
            <p>ALL CHALLENGERS</p>
            <h2 id={headingId}>전체 랭킹</h2>
          </div>
          <div className={styles.fullRankingMeta}>
            <span>{STORAGE_STATUS_LABEL[storageMode]}</span>
            <strong>{records.length.toLocaleString("ko-KR")}</strong>
            <small>명 참여</small>
          </div>
          <button aria-label="전체 랭킹 닫기" onClick={onClose} type="button">
            닫기 <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className={styles.fullRankingLegend} aria-hidden="true">
          {[0, 1, 2].map((column) => (
            <div key={column}>
              <span>RANK</span>
              <span>CHALLENGER</span>
              <span>SCORE</span>
            </div>
          ))}
        </div>

        {open && records.length > 0 ? (
          <ol className={styles.fullRankGrid}>
            {records.map((record, index) => (
              <li
                aria-current={record.id === highlightId ? "true" : undefined}
                className={record.id === highlightId ? styles.fullRankHighlighted : undefined}
                data-podium={index < 3 ? "true" : undefined}
                key={record.id}
              >
                <span className={styles.fullRankNumber}>
                  {String(index + 1).padStart(3, "0")}
                </span>
                <strong>{record.name}</strong>
                <span className={styles.fullRankScore}>
                  <b>{record.score}</b>
                  <small>PTS</small>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.fullRankingEmpty}>
            <strong>아직 기록이 없어요.</strong>
            <span>첫 번째 구르미를 기다리고 있습니다.</span>
          </div>
        )}

        <footer className={styles.fullRankingFooter}>
          <span>점수순 · 동점일 경우 보정점수와 기록시각 순</span>
          <b>AWS Community Day 2026 · BOOTH 03</b>
        </footer>
      </div>
    </dialog>
  );
}

function Leaderboard({
  records,
  storageMode,
  highlightId,
  pendingCount = 0,
  storageNotice = "",
}: {
  records: ScoreRecord[];
  storageMode: StorageMode;
  highlightId?: string;
  pendingCount?: number;
  storageNotice?: string;
}) {
  const [fullRankingOpen, setFullRankingOpen] = useState(false);
  const topFive = records.slice(0, 5);

  return (
    <>
      <div className={styles.leaderboard}>
        <div className={styles.leaderboardHeading}>
          <div>
            <p>TODAY&apos;S RANKING</p>
            <h2>오늘의 TOP 5</h2>
          </div>
          <span>
            {STORAGE_STATUS_LABEL[storageMode]}
            {storageMode === "offline" && pendingCount > 0 ? ` · ${pendingCount}` : ""}
          </span>
        </div>
        {topFive.length > 0 ? (
          <ol className={styles.rankList}>
            {topFive.map((record, index) => (
              <li
                className={record.id === highlightId ? styles.highlightedRank : undefined}
                key={record.id}
              >
                <span className={styles.rankNumber}>{String(index + 1).padStart(2, "0")}</span>
                <strong>{record.name}</strong>
                <b>{record.score}</b>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.emptyRanking}>
            <strong>첫 번째 기록을 기다리는 중</strong>
            <span>오늘의 1위가 되어보세요.</span>
          </div>
        )}
        <div className={styles.leaderboardFooter}>
          {(storageNotice || storageMode === "offline") && (
            <p className={styles.localNotice}>
              {storageNotice || "연결 전까지 이 기기에 보관하고 자동으로 다시 저장합니다."}
            </p>
          )}
          <button
            className={styles.fullRankingButton}
            disabled={records.length === 0}
            onClick={() => setFullRankingOpen(true)}
            type="button"
          >
            <span>전체 랭킹</span>
            <b>{records.length.toLocaleString("ko-KR")}명</b>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
      <FullLeaderboard
        highlightId={highlightId}
        onClose={() => setFullRankingOpen(false)}
        open={fullRankingOpen}
        records={records}
        storageMode={storageMode}
      />
    </>
  );
}

export function GurumiGame() {
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const resultSectionRef = useRef<HTMLElement>(null);
  const recordsRef = useRef<ScoreRecord[]>([]);
  const synchronizingRef = useRef(false);
  const roundFinishedRef = useRef(false);
  const revealTimeoutRef = useRef<number | null>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [name, setName] = useState("");
  const [countdown, setCountdown] = useState(3);
  const [secondsLeft, setSecondsLeft] = useState(ROUND_DURATION / 1_000);
  const [referenceModel, setReferenceModel] = useState<GurumiReferenceModel | null>(null);
  const [records, setRecords] = useState<ScoreRecord[]>([]);
  const [currentRecord, setCurrentRecord] = useState<ScoreRecord | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>("loading");
  const [roundSession, setRoundSession] = useState<GurumiRoundSession | null>(null);
  const [roundStarting, setRoundStarting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [storageNotice, setStorageNotice] = useState("");
  const [startError, setStartError] = useState("");

  useEffect(() => {
    const cachedRecords = readCachedRecords();
    recordsRef.current = cachedRecords;
    setRecords(cachedRecords);
  }, []);

  useEffect(
    () => () => {
      if (revealTimeoutRef.current !== null) window.clearTimeout(revealTimeoutRef.current);
    },
    [],
  );

  const persistRecords = useCallback((nextRecords: ScoreRecord[]) => {
    try {
      window.localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(nextRecords));
    } catch {
      // The round still completes if private browsing or storage limits block persistence.
    }
  }, []);

  const synchronizeRecords = useCallback(async () => {
    if (synchronizingRef.current) return;
    synchronizingRef.current = true;
    let pendingScores = await listPendingGurumiScores();
    let serverRecords: ScoreRecord[] | null = null;
    let rejectedCount = 0;

    try {
      for (const pending of [...pendingScores]) {
        try {
          const response = await submitScore(pending.submission);
          serverRecords = response.leaderboard;
          await deletePendingGurumiScore(pending.id);
          pendingScores = pendingScores.filter((candidate) => candidate.id !== pending.id);
        } catch (error) {
          if (error instanceof ScoreSubmissionError && !error.retryable) {
            await deletePendingGurumiScore(pending.id);
            pendingScores = pendingScores.filter((candidate) => candidate.id !== pending.id);
            rejectedCount += 1;
            continue;
          }
          throw error;
        }
      }

      serverRecords ??= await loadServerLeaderboard();
      pendingScores = await listPendingGurumiScores();
      const nextRecords = mergeRecords(serverRecords, pendingScores);
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      setCurrentRecord((current) =>
        current ? nextRecords.find((record) => record.id === current.id) ?? current : null,
      );
      persistRecords(nextRecords);
      setPendingCount(pendingScores.length);
      setStorageMode(pendingScores.length > 0 ? "offline" : "live");
      setStorageNotice(
        rejectedCount > 0
          ? `${rejectedCount}개 기록은 형식이 맞지 않아 자동 재시도에서 제외했습니다.`
          : "",
      );
    } catch {
      const nextRecords = mergeRecords(readCachedRecords(), pendingScores);
      recordsRef.current = nextRecords;
      setRecords(nextRecords);
      setPendingCount(pendingScores.length);
      setStorageMode("offline");
    } finally {
      synchronizingRef.current = false;
    }
  }, [persistRecords]);

  useEffect(() => {
    void synchronizeRecords();
    const interval = window.setInterval(() => {
      void synchronizeRecords();
    }, LEADERBOARD_REFRESH_INTERVAL);
    return () => window.clearInterval(interval);
  }, [synchronizeRecords]);

  const finishRound = useCallback(async () => {
    if (roundFinishedRef.current || !referenceModel || !roundSession) return;
    roundFinishedRef.current = true;
    setSecondsLeft(0);
    setPhase("scoring");
    setStorageMode("saving");
    const scoringStartedAt = performance.now();

    const strokes = canvasRef.current?.getStrokes() ?? [];
    const score = scoreDrawing(strokes, referenceModel);
    const normalizedName = normalizeGurumiName(name);
    if (!normalizedName) return;
    const id = roundSession.id;
    const localRecord = createScoreRecord({
      id,
      name: normalizedName,
      createdAt: new Date().toISOString(),
      score,
      characterId: roundSession.characterId,
    });
    const { encoded } = encodeStrokes(strokes);
    const submission: ScoreSubmission = {
      id,
      name: localRecord.name,
      roundToken: roundSession.token,
      strokes: encoded,
    };
    let record = localRecord;
    let nextRecords: ScoreRecord[];

    try {
      const response = await submitScore(submission);
      record = response.record;
      nextRecords = sortRecords(response.leaderboard).slice(0, GURUMI_LEADERBOARD_LIMIT);
      await deletePendingGurumiScore(record.id);
      const remainingPending = await listPendingGurumiScores();
      setPendingCount(remainingPending.length);
      setStorageMode(remainingPending.length > 0 ? "offline" : "live");
      setStorageNotice("");
    } catch (error) {
      const retryable = !(error instanceof ScoreSubmissionError) || error.retryable;
      if (retryable) {
        try {
          await savePendingGurumiScore({
            id: localRecord.id,
            record: localRecord,
            submission,
          });
          setStorageNotice("");
        } catch {
          setStorageNotice("이 기록을 자동 백업하지 못했습니다. 화면을 유지하고 운영진에게 알려주세요.");
        }
      } else {
        setStorageNotice(
          error instanceof Error
            ? error.message
            : "이 기록을 서버에 저장하지 못했습니다. 운영진에게 알려주세요.",
        );
      }
      const pendingScores = await listPendingGurumiScores();
      setPendingCount(pendingScores.length);
      nextRecords = sortRecords([...recordsRef.current, localRecord]).slice(
        0,
        GURUMI_LEADERBOARD_LIMIT,
      );
      setStorageMode("offline");
    }

    setCurrentRecord(record);
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    persistRecords(nextRecords);

    const remainingRevealDelay = Math.max(0, 900 - (performance.now() - scoringStartedAt));
    revealTimeoutRef.current = window.setTimeout(() => {
      setPhase("result");
    }, remainingRevealDelay);
  }, [name, persistRecords, referenceModel, roundSession]);

  useEffect(() => {
    if (phase !== "reveal") return;
    const timeout = window.setTimeout(() => setPhase("countdown"), 4_000);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const startedAt = performance.now();
    setCountdown(3);

    const interval = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const nextCount = Math.ceil((3_000 - elapsed) / 1_000);
      if (nextCount <= 0) {
        window.clearInterval(interval);
        setPhase("drawing");
      } else {
        setCountdown(nextCount);
      }
    }, 50);

    return () => window.clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    if (phase !== "drawing") return;
    const deadline = performance.now() + ROUND_DURATION;
    let animationFrame = 0;

    const tick = () => {
      const remaining = Math.max(0, deadline - performance.now());
      const nextSeconds = Math.ceil(remaining / 1_000);
      setSecondsLeft((previousSeconds) =>
        previousSeconds === nextSeconds ? previousSeconds : nextSeconds,
      );
      if (remaining <= 0) {
        void finishRound();
        return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [finishRound, phase]);

  useEffect(() => {
    if (phase !== "result") return;
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      resultSectionRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  const sortedRecords = useMemo(() => sortRecords(records), [records]);
  const currentRank = useMemo(() => {
    if (!currentRecord) return null;
    const index = sortedRecords.findIndex((record) => record.id === currentRecord.id);
    return index >= 0 ? index + 1 : null;
  }, [currentRecord, sortedRecords]);
  const normalizedName = normalizeGurumiName(name);
  const validName = normalizedName !== null;
  const character = getGurumiCharacter(roundSession?.characterId) ?? GURUMI_CHARACTERS[0];
  const referenceImage = characterImage(character.id);

  const startRound = async () => {
    if (!normalizedName || roundStarting) return;
    setRoundStarting(true);
    setStartError("");

    try {
      const session = await prepareRound();
      const model = await loadReferenceModel(characterImage(session.characterId));
      setReferenceModel(model);
      setRoundSession(session);
      setName(normalizedName);
      roundFinishedRef.current = false;
      if (revealTimeoutRef.current !== null) window.clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
      canvasRef.current?.clear();
      setSecondsLeft(ROUND_DURATION / 1_000);
      setCurrentRecord(null);
      setPhase("reveal");
    } catch (error) {
      setStartError(
        error instanceof Error
          ? error.message
          : "게임을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setRoundStarting(false);
    }
  };

  const resetForNextParticipant = () => {
    canvasRef.current?.clear();
    setName("");
    setRoundSession(null);
    setStartError("");
    setCurrentRecord(null);
    setSecondsLeft(ROUND_DURATION / 1_000);
    setPhase("intro");
  };

  const exportRecords = () => {
    const escapeCell = (value: string | number) => {
      const text = String(value);
      const spreadsheetSafeText = typeof value === "string" && /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${spreadsheetSafeText.replaceAll('"', '""')}"`;
    };
    const rows = [
      [
        "순위",
        "닉네임",
        "소모임",
        "점수",
        "보정점수",
        "원시점수",
        "의미점수",
        "전체형태점수",
        "잉크밀도",
        "겹쳐그리기효율",
        "선방향다양성",
        "반복폐곡선",
        ...ADAPTIVE_PART_IDS.map((part) => PART_LABELS[part]),
        "기록시각",
        "채점버전",
      ],
      ...sortedRecords.map((record, index) => [
        index + 1,
        record.name,
        characterLabel(record.characterId),
        record.score,
        record.calibrated.toFixed(6),
        record.raw.toFixed(6),
        record.semantic.toFixed(6),
        record.global.toFixed(6),
        record.densityRatio.toFixed(6),
        record.overdrawEfficiency.toFixed(6),
        record.orientationEntropy.toFixed(6),
        record.loopMonotony.toFixed(6),
        ...ADAPTIVE_PART_IDS.map((part) => (record.partScores[part] ?? 0).toFixed(6)),
        record.createdAt,
        record.scoreVersion,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCell).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `awskrug-gurumi-scores-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (phase === "intro") {
    return (
      <main className={styles.page}>
        <SketchbookDecor />
        <KioskHeader />
        <div className={styles.introLayout}>
          <section className={styles.introCopy}>
            <p className={styles.eyebrow}>우리들의 구르미 그림대회</p>
            <h1 aria-label="DRAW GURUMI">
              <span className={styles.titleWord} aria-hidden="true">{"DRAW".split("").map((letter, index) => <span key={index}>{letter}</span>)}</span>
              <strong className={styles.titleWord} aria-hidden="true">{"GURUMI".split("").map((letter, index) => <span key={index}>{letter}</span>)}</strong>
            </h1>
            <p className={styles.introLead}>
              오늘은 어떤 구르미를 그릴까요?
              <br />
              AWSKRUG의 13가지 친구들, 30초 동안 자유롭게 따라 그려요.
            </p>

            <div className={styles.ruleRow} aria-label="게임 규칙">
              <span><b>01</b> 마우스로 그리기</span>
              <span><b>02</b> 제한 시간 30초</span>
              <span><b>03</b> 자동 채점</span>
            </div>

            <div className={styles.entryForm}>
              <label htmlFor="gurumi-name">기록에 남길 닉네임</label>
              <div className={styles.inputRow}>
                <input
                  id="gurumi-name"
                  aria-invalid={name.length > 0 && !validName ? "true" : undefined}
                  autoComplete="off"
                  placeholder="2–10자로 입력"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void startRound();
                  }}
                />
                <button
                  disabled={!validName || roundStarting}
                  onClick={() => void startRound()}
                  type="button"
                >
                  {roundStarting ? "구르미 뽑는 중…" : "랜덤 구르미 만나기"}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
              <p>소모임 소개 후 그리기가 시작돼요. 닉네임과 점수는 랭킹에 공개돼요.</p>
              {startError && <p className={styles.errorMessage}>{startError}</p>}
            </div>
          </section>

          <section className={styles.introVisual} aria-label="그리기 기준 이미지">
            <div className={styles.characterCard}>
              <div className={styles.characterLabel}>
                <span>TARGET</span>
                <b>AWSKRUG · 13 CHARACTERS</b>
              </div>
              <Image
                alt={`${character.group} 구르미`}
                className={styles.characterImage}
                height={1254}
                priority
                sizes="(max-width: 900px) 82vw, 38vw"
                src={referenceImage}
                width={1254}
              />
              <div className={styles.featuredGroup}>
                <b>{character.group}</b>
                <p>{character.description}</p>
              </div>
              <div className={styles.characterGallery} aria-label="13개 AWSKRUG 소모임 구르미">
                {GURUMI_CHARACTERS.map((item) => <Image key={item.id} src={characterImage(item.id)} alt={item.group} title={item.group} width={72} height={72} />)}
              </div>
            </div>
          </section>

          <aside className={styles.introRanking}>
            <Leaderboard
              pendingCount={pendingCount}
              records={sortedRecords}
              storageMode={storageMode}
              storageNotice={storageNotice}
            />
            <details className={styles.operatorTools}>
              <summary>운영 도구</summary>
              <div>
                <button disabled={sortedRecords.length === 0} onClick={exportRecords} type="button">
                  CSV 내보내기
                </button>
              </div>
            </details>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <SketchbookDecor />
      <KioskHeader />
      <div className={styles.gameLayout}>
        <div className={styles.gameStatus}>
          <div>
            <p>CHALLENGER</p>
            <strong>{name.trim()}</strong>
          </div>
          <div className={styles.phaseLabel}>
            {phase === "reveal" && "MEET YOUR GURUMI"}
            {phase === "countdown" && "READY"}
            {phase === "drawing" && "DRAW NOW"}
            {phase === "scoring" && "ANALYZING"}
            {phase === "result" && "RESULT"}
          </div>
          <div className={styles.timer} data-danger={phase === "drawing" && secondsLeft <= 5}>
            <span>TIME LEFT</span>
            <strong aria-live="polite">{secondsLeft}</strong>
            <small>SEC</small>
          </div>
        </div>

        <div className={styles.gameStage}>
          <section className={styles.referencePanel}>
            <div className={styles.panelHeading}>
              <span>REFERENCE</span>
              <b>AWSKRUG {character.group}</b>
            </div>
            <p className={styles.referenceDescription}>{character.description}</p>
            <div className={styles.referenceImageWrap}>
              <Image
                alt={`${character.group} 구르미 기준 이미지`}
                fill
                priority
                sizes="(max-width: 900px) 88vw, 40vw"
                src={referenceImage}
              />
            </div>
          </section>

          <section className={styles.canvasPanel}>
            <div className={styles.panelHeading}>
              <span>YOUR DRAWING</span>
              <div className={styles.canvasActions}>
                <button disabled={phase !== "drawing"} onClick={() => canvasRef.current?.undo()} type="button">
                  한 획 취소
                </button>
                <button disabled={phase !== "drawing"} onClick={() => canvasRef.current?.clear()} type="button">
                  전체 지우기
                </button>
              </div>
            </div>
            <DrawingCanvas disabled={phase !== "drawing"} ref={canvasRef} />
          </section>

          {phase === "reveal" && (
            <div className={styles.revealOverlay} role="status" aria-live="polite">
              <span className={styles.revealEyebrow}>MEET YOUR GURUMI</span>
              <Image src={referenceImage} alt={`${character.group} 구르미`} width={260} height={260} priority />
              <p>AWSKRUG</p>
              <h2>{character.group}</h2>
              <p className={styles.groupDescription}>{character.description}</p>
              <small>잠시 후 30초 그리기가 시작됩니다</small>
            </div>
          )}

          {phase === "countdown" && (
            <div className={styles.countdownOverlay} aria-live="assertive">
              <p>{character.group} 구르미를 잘 봐주세요</p>
              <strong key={countdown}>{countdown}</strong>
              <span>마우스를 준비하세요</span>
            </div>
          )}

          {phase === "scoring" && (
            <div className={styles.scoringOverlay} aria-live="polite">
              <div className={styles.scoringCloud} aria-hidden="true">☁</div>
              <strong>구르미와 닮은 점을 찾는 중…</strong>
              <span>완성된 그림을 원본과 비교하고 있어요.</span>
            </div>
          )}
        </div>

        {phase === "result" && currentRecord && (
          <section className={styles.resultSection} ref={resultSectionRef}>
            <div className={styles.scoreCard}>
              <p>MATCH SCORE · {characterLabel(currentRecord.characterId)}</p>
              <div className={styles.scoreValue}>
                <strong>{currentRecord.score}</strong>
                <span>점</span>
              </div>
              <h2>{resultMessage(currentRecord.score)}</h2>
              <p className={styles.rankCopy}>
                {currentRank === 1
                  ? "새로운 1위 기록이에요!"
                  : currentRank
                    ? `현재 ${currentRank}위예요. 순위는 행사 종료 전까지 바뀔 수 있어요.`
                    : "기록을 저장했어요."}
              </p>
              <button onClick={resetForNextParticipant} type="button">
                다음 참가자 <span aria-hidden="true">→</span>
              </button>
            </div>
            <Leaderboard
              highlightId={currentRecord.id}
              pendingCount={pendingCount}
              records={sortedRecords}
              storageMode={storageMode}
              storageNotice={storageNotice}
            />
          </section>
        )}
      </div>
    </main>
  );
}

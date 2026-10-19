"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import type { ScoreRecord } from "@/lib/gurumi/records";
import type { Stroke } from "@/lib/gurumi/similarity";
import { decodeStrokes } from "@/lib/gurumi/stroke-codec";

import styles from "./GurumiAwards.module.css";

function SavedDrawing({ id, name }: { id: string; name: string }) {
  const [strokes, setStrokes] = useState<Stroke[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setError("");
    setStrokes(null);
    void (async () => {
      try {
        const response = await fetch(`/gurumi/admin/drawings/${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "그림을 불러오지 못했습니다.");
        if (typeof body.strokes !== "string") throw new Error("그림 데이터가 올바르지 않습니다.");
        const drawing = decodeStrokes(body.strokes);
        if (active) setStrokes(drawing.strokes);
      } catch (cause) {
        if (active) setError(controller.signal.aborted
          ? "연결이 지연되고 있습니다. 다시 시도해 주세요."
          : cause instanceof Error ? cause.message : "그림을 불러오지 못했습니다.");
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [id, attempt]);

  if (error) return <div className={styles.drawingMessage} role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)} type="button">다시 불러오기</button></div>;
  if (strokes === null) return <div className={styles.drawingMessage} role="status">그림을 불러오는 중…</div>;
  return (
    <>
      <svg className={styles.drawing} viewBox="0 0 1000 1000" role="img" aria-label={`${name} 참가자가 그린 구르미`}>
        <rect width="1000" height="1000" fill="white" />
        {strokes.map(({ points }, index) => points.length === 1 ? (
          <circle key={index} cx={points[0].x * 1000} cy={points[0].y * 1000} r="6" fill="#111111" />
        ) : (
          <polyline key={index} points={points.map(({ x, y }) => `${x * 1000},${y * 1000}`).join(" ")} fill="none" stroke="#111111" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {strokes.length === 0 && <span className={styles.blankNote}>그려진 선이 없는 기록입니다.</span>}
    </>
  );
}

export function GurumiAwards({ records, initialIndex, onClose }: {
  records: ScoreRecord[];
  initialIndex: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ownsFullscreen = useRef(false);
  const [index, setIndex] = useState(initialIndex);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const record = records[index];

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const syncFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      if (!document.fullscreenElement) ownsFullscreen.current = false;
    };
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("fullscreenchange", syncFullscreen);
      if (ownsFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      dialog?.close();
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      setFullscreenError("");
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        // A modal dialog itself cannot be a fullscreen target.
        await document.documentElement.requestFullscreen();
        ownsFullscreen.current = true;
        // Fullscreen moves the root into the top layer; lift the modal above it again.
        dialogRef.current?.close();
        dialogRef.current?.showModal();
      }
    } catch {
      setFullscreenError("브라우저의 전체 화면 메뉴를 사용해 주세요.");
    }
  };

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="gurumi-award-title" onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).tagName === "SELECT") return;
        if (event.key === "ArrowRight") { event.preventDefault(); setIndex((value) => Math.min(records.length - 1, value + 1)); }
        if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); }
      }}>
      <header className={styles.header}>
        <span>AUSGCON 2026 <b>GURUMI AWARDS</b></span>
        <div>
          <button type="button" onClick={toggleFullscreen}>{fullscreen ? "전체 화면 해제" : "전체 화면"}</button>
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </header>
      <div className={styles.stage}>
        <section className={styles.winner}>
          <p>구르미 그리기</p>
          <div className={styles.rank}><strong>{index + 1}</strong><span>위</span></div>
          <h2 id="gurumi-award-title">{record.name}</h2>
          <div className={styles.score}>{record.score}<span>점</span></div>
          <div className={styles.reference}>
            <Image src="/assets/ausgcon/gurumi/reference.png" alt="따라 그린 원본 구르미" width={160} height={160} />
            <span>이 구르미를 보고<br />30초 동안 그렸어요!</span>
          </div>
        </section>
        <figure className={styles.artwork}>
          <SavedDrawing key={record.id} id={record.id} name={record.name} />
          <figcaption>{record.name} 님의 구르미</figcaption>
        </figure>
      </div>
      <footer className={styles.controls}>
        <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>{index === 0 ? "첫 번째 순위" : `← ${index}위`}</button>
        <label><span>순위 선택</span><select aria-label="보여줄 순위" value={index} onChange={(event) => setIndex(Number(event.target.value))}>
          {records.map((item, position) => <option key={item.id} value={position}>{position + 1}위</option>)}
        </select></label>
        <button type="button" disabled={index >= records.length - 1} onClick={() => setIndex(index + 1)}>{index >= records.length - 1 ? "마지막 순위" : `${index + 2}위 보기 →`}</button>
      </footer>
      <p className={styles.hint}>{fullscreenError || "← → 방향키로 순위 이동 · ESC로 닫기"}</p>
    </dialog>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { GURUMI_SCORE_GRID_SIZE, type GurumiOverlapComparison } from "@/lib/gurumi/similarity";
import styles from "./GurumiGame.module.css";

export function DrawingComparison({ comparison }: { comparison: GurumiOverlapComparison }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<"overlap" | "reference" | "drawing">("overlap");
  useEffect(() => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const size = GURUMI_SCORE_GRID_SIZE;
    const pixels = context.createImageData(size, size);
    for (let i = 0; i < comparison.referenceMask.length; i++) {
      const reference = view !== "drawing" && comparison.referenceMask[i];
      const drawing = view !== "reference" && comparison.userMask[i];
      const color = reference && drawing ? [38, 139, 96] : reference ? [91, 133, 201] : drawing ? [218, 111, 84] : [255, 255, 255];
      pixels.data.set([...color, 255], i * 4);
    }
    context.putImageData(pixels, 0, 0);
  }, [comparison, view]);

  return <section className={styles.comparisonPanel} aria-label="원본과 내 그림 겹침 비교">
    <div className={styles.comparisonHeader}>
      <div><h2>겹쳐 보면 알 수 있어요</h2><p>채점에 사용한 두 그림을 같은 위치와 크기로 맞췄어요.</p></div>
      <div className={styles.comparisonTabs} role="group" aria-label="비교 화면 선택">
        {([["overlap", "겹쳐 보기"], ["reference", "원본 선"], ["drawing", "내 그림 선"]] as const).map(([mode, label]) =>
          <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{label}</button>)}
      </div>
    </div>
    <div className={styles.comparisonBody}>
      <div>
        <canvas ref={canvasRef} width={GURUMI_SCORE_GRID_SIZE} height={GURUMI_SCORE_GRID_SIZE} role="img" aria-label="초록은 원본과 겹친 선, 파랑은 빠진 원본 선, 주황은 원본에서 벗어난 내 선입니다." />
        <div className={styles.comparisonLegend}><span data-color="match">겹친 선</span><span data-color="reference">빠진 원본 선</span><span data-color="drawing">벗어난 내 선</span></div>
      </div>
      <div className={styles.comparisonExplanation}>
        <p><b>{Math.round(comparison.precision * 100)}%</b><span>내 선 중 원본과 겹친 비율</span></p>
        <p><b>{Math.round(comparison.recall * 100)}%</b><span>원본 선을 완성한 비율</span></p>
        <div className={styles.comparisonFormula}><strong>점수 = 겹친 영역 ÷ 두 그림의 전체 선 영역</strong><span>초록 ÷ (초록 + 파랑 + 주황) × 100</span></div>
        <small>색상이나 그린 순서는 채점하지 않아요. 선 굵기는 같게 맞추고, 반복 감점이나 소모임별 보너스 없이 겹침만 비교해요.</small>
      </div>
    </div>
  </section>;
}

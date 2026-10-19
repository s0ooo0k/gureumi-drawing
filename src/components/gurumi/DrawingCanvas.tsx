"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { Stroke, StrokePoint } from "@/lib/gurumi/similarity";
import { GURUMI_MAX_POINT_COUNT } from "@/lib/gurumi/stroke-codec";

import styles from "./GurumiGame.module.css";

export type DrawingCanvasHandle = {
  clear: () => void;
  getStrokes: () => Stroke[];
  undo: () => void;
};

type DrawingCanvasProps = {
  disabled: boolean;
};

function cloneStrokes(strokes: Stroke[]) {
  return strokes.map((stroke) => ({
    points: stroke.points.map((point) => ({ ...point })),
  }));
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(
  function DrawingCanvas({ disabled }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const strokesRef = useRef<Stroke[]>([]);
    const activeStrokeRef = useRef<Stroke | null>(null);
    const activePointerRef = useRef<number | null>(null);
    const pointCountRef = useRef(0);
    const [hasInk, setHasInk] = useState(false);

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "#111111";
      context.fillStyle = "#111111";
      context.lineWidth = Math.max(6, width * 0.012);
      context.lineCap = "round";
      context.lineJoin = "round";

      const drawStroke = (stroke: Stroke) => {
        if (stroke.points.length === 0) return;
        const first = stroke.points[0];
        if (stroke.points.length === 1) {
          context.beginPath();
          context.arc(first.x * width, first.y * height, context.lineWidth / 2, 0, Math.PI * 2);
          context.fill();
          return;
        }

        context.beginPath();
        context.moveTo(first.x * width, first.y * height);
        for (let index = 1; index < stroke.points.length; index += 1) {
          const point = stroke.points[index];
          context.lineTo(point.x * width, point.y * height);
        }
        context.stroke();
      };

      strokesRef.current.forEach(drawStroke);
      if (activeStrokeRef.current) drawStroke(activeStrokeRef.current);
    }, []);

    const commitActiveStroke = useCallback(() => {
      if (activeStrokeRef.current?.points.length) {
        strokesRef.current.push(activeStrokeRef.current);
        setHasInk(true);
      }
      activeStrokeRef.current = null;
      activePointerRef.current = null;
      redraw();
    }, [redraw]);

    useImperativeHandle(
      ref,
      () => ({
        clear() {
          strokesRef.current = [];
          activeStrokeRef.current = null;
          activePointerRef.current = null;
          pointCountRef.current = 0;
          setHasInk(false);
          redraw();
        },
        getStrokes() {
          const strokes = activeStrokeRef.current
            ? [...strokesRef.current, activeStrokeRef.current]
            : strokesRef.current;
          return cloneStrokes(strokes);
        },
        undo() {
          if (activeStrokeRef.current) {
            pointCountRef.current -= activeStrokeRef.current.points.length;
          } else {
            const removedStroke = strokesRef.current.pop();
            if (removedStroke) pointCountRef.current -= removedStroke.points.length;
          }
          activeStrokeRef.current = null;
          activePointerRef.current = null;
          pointCountRef.current = Math.max(0, pointCountRef.current);
          setHasInk(strokesRef.current.length > 0);
          redraw();
        },
      }),
      [redraw],
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const resize = () => {
        const bounds = canvas.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(bounds.width * ratio));
        const height = Math.max(1, Math.round(bounds.height * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        redraw();
      };

      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();

      return () => observer.disconnect();
    }, [redraw]);

    useEffect(() => {
      if (disabled && activeStrokeRef.current) commitActiveStroke();
    }, [commitActiveStroke, disabled]);

    const pointFromEvent = useCallback((event: PointerEvent): StrokePoint => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const bounds = canvas.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
        y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
      };
    }, []);

    const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (
        disabled ||
        activePointerRef.current !== null ||
        pointCountRef.current >= GURUMI_MAX_POINT_COUNT
      ) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointerRef.current = event.pointerId;
      activeStrokeRef.current = { points: [pointFromEvent(event.nativeEvent)] };
      pointCountRef.current += 1;
      setHasInk(true);
      redraw();
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (disabled || activePointerRef.current !== event.pointerId || !activeStrokeRef.current) return;
      event.preventDefault();
      const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
      for (const coalescedEvent of coalescedEvents) {
        if (pointCountRef.current >= GURUMI_MAX_POINT_COUNT) break;
        const point = pointFromEvent(coalescedEvent);
        const previousPoint = activeStrokeRef.current.points.at(-1);
        if (
          previousPoint &&
          Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) < 0.001
        ) continue;
        activeStrokeRef.current.points.push(point);
        pointCountRef.current += 1;
      }
      redraw();
    };

    const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      commitActiveStroke();
    };

    return (
      <div className={styles.canvasShell} data-disabled={disabled}>
        <canvas
          ref={canvasRef}
          className={styles.drawingSurface}
          aria-label="마우스로 구르미를 그리는 캔버스"
          onContextMenu={(event) => event.preventDefault()}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
        />
        {!hasInk && (
          <div className={styles.canvasHint} aria-hidden="true">
            <span>여기에 그려주세요</span>
            <small>CLICK &amp; DRAG</small>
          </div>
        )}
      </div>
    );
  },
);

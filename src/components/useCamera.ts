"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { liveIssue, lookingAtCamera, summarizeVideo, type IssueClock, type LiveIssue, type VideoFrame, type VideoMetrics } from "@/lib/video/analysis";

export type { LiveIssue };
import type { FaceTracker } from "@/lib/video/tracker";

/**
 * The candidate's camera: a self-view, plus on-device face tracking while they answer.
 * Frames are analysed in the browser and discarded; only the summary is sent.
 */
export function useCamera() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<"off" | "loading" | "ready" | "failed">("off");
  const [live, setLive] = useState<{ face: boolean; contact: boolean; issue: LiveIssue | null } | null>(null);
  /** When each problem started, while it lasts. */
  const since = useRef<IssueClock>({ tilted: null, gone: null, away: null });
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const tracker = useRef<FaceTracker | null>(null);
  const frames = useRef<VideoFrame[]>([]);
  const analysing = useRef(false);
  const started = useRef(0);

  /** Callback ref for the self-view <video>. */
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => {});
    }
  }, []);

  const loadTracker = useCallback(async () => {
    if (tracker.current || tracking === "loading") return;
    setTracking("loading");
    try {
      const { FaceTracker } = await import("@/lib/video/tracker");
      const t = new FaceTracker();
      await t.load();
      tracker.current = t;
      setTracking("ready");
    } catch (e) {
      console.warn("[camera] face tracking unavailable:", e);
      setTracking("failed");
    }
  }, [tracking]);

  const start = useCallback(async () => {
    setError(null);
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } });
      setOn(true);
      if (video.current) attach(video.current);
      void loadTracker();
      return true;
    } catch {
      setError("Camera access was blocked or no camera was found. You can continue with audio only.");
      setOn(false);
      return false;
    }
  }, [attach, loadTracker]);

  const stopAnalysis = useCallback((): VideoMetrics | null => {
    analysing.current = false;
    setLive(null);
    const m = summarizeVideo(frames.current);
    frames.current = [];
    return m;
  }, []);

  const stop = useCallback(() => {
    stopAnalysis();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setOn(false);
  }, [stopAnalysis]);

  /** Samples the camera about five times a second until stopAnalysis(); never queues work. */
  const startAnalysis = useCallback(() => {
    if (!on || analysing.current) return;
    frames.current = [];
    since.current = { tilted: null, gone: null, away: null };
    analysing.current = true;
    started.current = performance.now();
    const loop = async () => {
      while (analysing.current) {
        const t0 = performance.now();
        const v = video.current;
        if (tracker.current && v && v.readyState >= 2) {
          try {
            const f = await tracker.current.sample(v, (t0 - started.current) / 1000);
            if (!analysing.current) break;
            frames.current.push(f);
            const issue = liveIssue(since.current, f.face, f.t);
            setLive({ face: f.face !== null, contact: f.face !== null && lookingAtCamera(f.face), issue });
          } catch {
            /* skip a bad frame */
          }
        }
        await new Promise((r) => setTimeout(r, Math.max(0, 200 - (performance.now() - t0))));
      }
    };
    void loop();
  }, [on]);

  useEffect(
    () => () => {
      analysing.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { on, error, tracking, live, attach, start, stop, startAnalysis, stopAnalysis };
}

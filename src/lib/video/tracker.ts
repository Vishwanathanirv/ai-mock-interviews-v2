import type { FaceSample, VideoFrame } from "./analysis";

/**
 * Face tracking on camera frames, in the browser. Uses the Human library (TensorFlow.js on WebGL)
 * with its face detector, mesh, iris and expression models, served from this site's own
 * /models/human folder. Loaded on demand, so pages that never use the camera never download it.
 */

type HumanFace = {
  boxRaw: [number, number, number, number];
  rotation?: { angle: { yaw: number; pitch: number; roll: number }; gaze: { bearing: number; strength: number } } | null;
  emotion?: { score: number; emotion: string }[];
};
type HumanInstance = {
  load: () => Promise<void>;
  warmup: () => Promise<unknown>;
  detect: (input: HTMLVideoElement | HTMLCanvasElement) => Promise<{ face: HumanFace[] }>;
};

const CONFIG = {
  modelBasePath: "/models/human/",
  backend: "webgl",
  debug: false,
  cacheSensitivity: 0,
  filter: { enabled: true, equalization: false },
  face: {
    enabled: true,
    detector: { modelPath: "blazeface.json", rotation: false, maxDetected: 1, minConfidence: 0.3 },
    mesh: { enabled: true, modelPath: "facemesh.json" },
    iris: { enabled: true, modelPath: "iris.json" },
    emotion: { enabled: true, modelPath: "emotion.json", minConfidence: 0.1 },
    description: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
    attention: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: true },
  segmentation: { enabled: false },
};

export class FaceTracker {
  private human: HumanInstance | null = null;
  private canvas: HTMLCanvasElement | null = null;

  async load(): Promise<void> {
    if (this.human) return;
    const mod = (await import("@vladmandic/human")) as unknown as { default?: new (c: object) => HumanInstance; Human?: new (c: object) => HumanInstance };
    const Human = mod.Human ?? mod.default!;
    const h = new Human(CONFIG);
    await h.load();
    await h.warmup();
    this.human = h;
  }

  /** Average brightness of the frame, 0 to 1, from a tiny downscaled copy. */
  private brightness(video: HTMLVideoElement): number {
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = 32;
      this.canvas.height = 24;
    }
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return 0.5;
    ctx.drawImage(video, 0, 0, 32, 24);
    const px = ctx.getImageData(0, 0, 32, 24).data;
    let s = 0;
    for (let i = 0; i < px.length; i += 4) s += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return s / (px.length / 4) / 255;
  }

  async sample(video: HTMLVideoElement, t: number): Promise<VideoFrame> {
    if (!this.human) throw new Error("Face tracking is not loaded");
    const brightness = this.brightness(video);
    const res = await this.human.detect(video);
    const f = res.face[0];
    if (!f) return { t, face: null, brightness };
    const [x, y, w, h] = f.boxRaw;
    const emotions = f.emotion ?? [];
    const top = [...emotions].sort((a, b) => b.score - a.score)[0];
    const face: FaceSample = {
      yaw: f.rotation?.angle.yaw ?? 0,
      pitch: f.rotation?.angle.pitch ?? 0,
      gaze: f.rotation?.gaze.strength ?? 0,
      cx: x + w / 2,
      cy: y + h / 2,
      w,
      area: w * h,
      happy: emotions.find((e) => e.emotion === "happy")?.score ?? 0,
      expression: top?.emotion ?? "neutral",
    };
    return { t, face, brightness };
  }
}

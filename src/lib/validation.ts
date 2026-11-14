import { z } from "zod";
import { FOCUSES, LEVELS, ROLES } from "@/lib/interview/types";

export const SignupInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(60),
  email: z.string().trim().email("Enter a valid email").max(120),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});

export const LoginInput = z.object({
  email: z.string().trim().email("Enter a valid email").max(120),
  password: z.string().min(1, "Enter your password").max(128),
});

export const NewInterviewInput = z.object({
  role: z.enum(ROLES),
  level: z.enum(LEVELS),
  focus: z.enum(FOCUSES),
  totalQuestions: z.number().int().min(3).max(10),
  targets: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
});

const n = (max: number) => z.number().finite().min(0).max(max);
const nn = (max: number) => n(max).nullable();

/** Summary numbers from the in-browser voice analysis; never raw audio. */
export const VoiceInput = z.object({
  durationSec: n(1800),
  speakingSec: n(1800),
  pauses: z.number().int().min(0).max(2000),
  longestPauseSec: n(1800),
  pauseRatio: n(1),
  pitchMedianHz: nn(1000),
  pitchSdSemitones: nn(48),
  pitchRangeSemitones: nn(96),
  monotone: z.boolean().nullable(),
  loudnessSdDb: nn(120),
  voicedFrames: z.number().int().min(0).max(1_000_000),
});

/** Summary numbers from in-browser face tracking; never images. */
export const VideoInput = z.object({
  durationSec: n(1800),
  frames: z.number().int().min(0).max(100_000),
  faceVisiblePct: n(100),
  eyeContactPct: n(100),
  lookAways: z.number().int().min(0).max(5000),
  smilePct: n(100),
  movement: n(100),
  framing: z.enum(["good", "too far", "too close", "off-centre"]),
  lighting: z.enum(["good", "dark", "too bright"]),
  expression: z.string().max(20).nullable(),
});

export const AnswerInput = z.object({
  answer: z.string().trim().min(1, "Say or type an answer first").max(6000),
  durationSec: z.number().min(0).max(1800),
  voice: VoiceInput.optional(),
  video: VideoInput.optional(),
});

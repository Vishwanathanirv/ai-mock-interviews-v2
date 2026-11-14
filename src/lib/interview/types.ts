import type { VideoMetrics } from "@/lib/video/analysis";
import type { VoiceMetrics } from "@/lib/voice/prosody";

export const ROLES = ["frontend", "backend", "fullstack", "java", "mobile", "qa", "devops", "cloud", "network", "security", "data", "analyst", "product"] as const;
export const LEVELS = ["intern", "junior", "mid", "senior"] as const;
export const FOCUSES = ["technical", "behavioral", "mixed"] as const;

export type Role = (typeof ROLES)[number];
export type Level = (typeof LEVELS)[number];
export type Focus = (typeof FOCUSES)[number];
export type QuestionKind = "technical" | "behavioral";

/** A concept the answer should cover; the first entry is its label, the rest are accepted synonyms. */
export type Concept = readonly string[];

export type BankQuestion = {
  id: string;
  kind: QuestionKind;
  topic: string;
  difficulty: 1 | 2 | 3;
  text: string;
  concepts: readonly Concept[];
  /** Asked when a key concept is missing; `{concept}` is replaced with its label. */
  probe?: string;
};

export type AskedQuestion = {
  id: string;
  kind: QuestionKind;
  topic: string;
  difficulty: 1 | 2 | 3;
  text: string;
  concepts: readonly Concept[];
  isFollowUp: boolean;
  parentId?: string;
};

export type DeliveryMetrics = {
  words: number;
  wpm: number | null;
  fillerCount: number;
  fillerRate: number;
  fillers: Record<string, number>;
  avgSentenceWords: number;
  hedges: number;
  hasNumbers: boolean;
  hasExample: boolean;
  star: { situation: boolean; task: boolean; action: boolean; result: boolean };
  /** Measured from the microphone signal when the answer was spoken. */
  voice?: VoiceMetrics;
  /** Words per minute of actual speaking time (pauses excluded), when voice data exists. */
  articulationWpm?: number | null;
  /** On-camera presence, measured in the browser when the camera was on. */
  video?: VideoMetrics;
};

export type ScoreBreakdown = {
  content: number;
  depth: number;
  structure: number;
  delivery: number;
};

export type AnswerEvaluation = {
  score: number;
  breakdown: ScoreBreakdown;
  covered: string[];
  missing: string[];
  strengths: string[];
  improvements: string[];
  metrics: DeliveryMetrics;
  source: "ai" | "rules";
  /** Things that would hurt the candidate in a real interview. */
  redFlags?: string[];
  /** What the interviewer says out loud after this answer (in character: no grades). */
  reaction?: string;
};

export type HireCall = "Strong hire" | "Hire" | "Lean hire" | "Lean no hire" | "No hire";

export type FinalReport = {
  overall: number;
  verdict: "Strong" | "Promising" | "Needs practice";
  summary: string;
  breakdown: ScoreBreakdown;
  strengths: string[];
  improvements: string[];
  studyTopics: string[];
  delivery: {
    avgWpm: number | null;
    fillerRate: number;
    totalWords: number;
    totalMinutes: number;
    /** Averages over spoken answers that had voice data. */
    voice?: { answers: number; pitchSdSemitones: number | null; monotoneAnswers: number; pausesPerMinute: number; longestPauseSec: number; pauseRatio: number };
    video?: { answers: number; eyeContactPct: number; lookAwaysPerAnswer: number; smilePct: number; movement: number; framing: string; lighting: string };
  };
  source: "ai" | "rules";
  /** What a hiring panel would decide, against the bar for this level. */
  decision?: { call: HireCall; bar: number; nextRound: boolean; reasons: string[] };
  /** The "any questions for me?" moment at the end. */
  closing?: { question: string; reply: string; note: string; asked: boolean };
};

export type InterviewConfig = {
  role: Role;
  level: Level;
  focus: Focus;
  totalQuestions: number;
  /** Topics to concentrate on (from the practice plan); questions come from these when possible. */
  targets?: string[];
};

export type HistoryItem = { question: AskedQuestion; answer: string; evaluation: AnswerEvaluation };

export const ROLE_LABELS: Record<Role, string> = {
  frontend: "Frontend Developer",
  backend: "Backend Developer",
  fullstack: "Full-stack Developer",
  devops: "DevOps / Linux Engineer",
  security: "Security Engineer",
  data: "Data / ML Engineer",
  java: "Java Developer",
  mobile: "Mobile Developer",
  qa: "QA / Test Automation Engineer",
  cloud: "Cloud / SRE Engineer",
  network: "Network Engineer",
  analyst: "Data Analyst",
  product: "Product Manager",
};

/** How the interviewer introduces her team, so the opening sounds like a real company. */
export const ROLE_TEAMS: Record<Role, string> = {
  frontend: "the web team",
  backend: "the platform team",
  fullstack: "the product engineering team",
  java: "the core services team",
  mobile: "the mobile team",
  qa: "the quality engineering team",
  devops: "the infrastructure team",
  cloud: "the reliability team",
  network: "the network operations team",
  security: "the security team",
  data: "the machine learning team",
  analyst: "the analytics team",
  product: "the product team",
};

export const LEVEL_LABELS: Record<Level, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
};

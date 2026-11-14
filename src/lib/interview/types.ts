export const ROLES = ["frontend", "backend", "fullstack", "devops", "security", "data"] as const;
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
};

export type FinalReport = {
  overall: number;
  verdict: "Strong" | "Promising" | "Needs practice";
  summary: string;
  breakdown: ScoreBreakdown;
  strengths: string[];
  improvements: string[];
  studyTopics: string[];
  delivery: { avgWpm: number | null; fillerRate: number; totalWords: number; totalMinutes: number };
  source: "ai" | "rules";
};

export type InterviewConfig = { role: Role; level: Level; focus: Focus; totalQuestions: number };

export type HistoryItem = { question: AskedQuestion; answer: string; evaluation: AnswerEvaluation };

export const ROLE_LABELS: Record<Role, string> = {
  frontend: "Frontend Developer",
  backend: "Backend Developer",
  fullstack: "Full-stack Developer",
  devops: "DevOps / Linux Engineer",
  security: "Security Engineer",
  data: "Data / ML Engineer",
};

export const LEVEL_LABELS: Record<Level, string> = {
  intern: "Intern",
  junior: "Junior",
  mid: "Mid-level",
  senior: "Senior",
};

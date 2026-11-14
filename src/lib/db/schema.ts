import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { AnswerEvaluation, FinalReport } from "@/lib/interview/types";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    isGuest: integer("is_guest").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    level: text("level").notNull(),
    focus: text("focus").notNull(),
    totalQuestions: integer("total_questions").notNull(),
    status: text("status").notNull().default("active"),
    provider: text("provider").notNull(),
    currentQuestion: jsonb("current_question").$type<import("@/lib/interview/types").AskedQuestion | null>(),
    overallScore: real("overall_score"),
    report: jsonb("report").$type<FinalReport | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("interviews_user_idx").on(t.userId, t.createdAt)],
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    questionId: text("question_id").notNull(),
    question: text("question").notNull(),
    kind: text("kind").notNull(),
    isFollowUp: integer("is_follow_up").notNull().default(0),
    answer: text("answer").notNull(),
    durationSec: real("duration_sec").notNull(),
    evaluation: jsonb("evaluation").$type<AnswerEvaluation>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("turns_interview_idx").on(t.interviewId, t.idx)],
);

export type User = typeof users.$inferSelect;
export type Interview = typeof interviews.$inferSelect;
export type Turn = typeof turns.$inferSelect;

/** Idempotent DDL kept next to the schema so a fresh database bootstraps itself. */
export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text,
  is_guest integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  level text NOT NULL,
  focus text NOT NULL,
  total_questions integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  provider text NOT NULL,
  current_question jsonb,
  overall_score real,
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS interviews_user_idx ON interviews (user_id, created_at);

CREATE TABLE IF NOT EXISTS turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  question_id text NOT NULL,
  question text NOT NULL,
  kind text NOT NULL,
  is_follow_up integer NOT NULL DEFAULT 0,
  answer text NOT NULL,
  duration_sec real NOT NULL,
  evaluation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS turns_interview_idx ON turns (interview_id, idx);
`;

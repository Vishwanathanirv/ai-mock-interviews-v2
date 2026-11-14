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
});

export const AnswerInput = z.object({
  answer: z.string().trim().min(1, "Say or type an answer first").max(6000),
  durationSec: z.number().min(0).max(1800),
});

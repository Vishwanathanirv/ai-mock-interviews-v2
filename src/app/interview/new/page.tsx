import { AppHeader } from "@/components/AppHeader";
import { SetupForm } from "@/components/SetupForm";

export const metadata = { title: "New interview" };

export default function NewInterview() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <p className="eyebrow">New interview</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Set up your interview</h1>
        <p className="mt-2 text-muted">Choose what you are preparing for. You can practise again with different settings any time.</p>
        <SetupForm />
      </main>
    </>
  );
}

import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <Logo />
        <h1 className="mt-10 font-display text-4xl font-semibold tracking-tight">Nothing to rehearse here</h1>
        <p className="mt-2 text-muted">That page doesn&apos;t exist, or it belongs to someone else.</p>
        <Link href="/dashboard" className="btn btn-primary mt-8">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}

import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { Logo } from "./Logo";
import { SignOutButton } from "./SignOutButton";

export async function AppHeader() {
  const s = await getSession();
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo href={s ? "/dashboard" : "/"} />
        <nav className="flex items-center gap-2 text-sm">
          {s ? (
            <>
              <Link href="/dashboard" className="hidden rounded-full px-3 py-2 text-muted hover:text-ink sm:inline">
                Practice log
              </Link>
              <Link href="/interview/new" className="btn btn-primary h-9 px-4 text-sm">
                New interview
              </Link>
              <span className="hidden text-muted md:inline">{s.guest ? "Guest" : s.name}</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-3 py-2 text-muted hover:text-ink">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary h-9 px-4 text-sm">
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

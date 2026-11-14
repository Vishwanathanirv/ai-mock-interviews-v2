import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2" aria-label="Rehearse home">
      <span className="relative grid h-8 w-8 place-items-center rounded-full bg-ink text-bg">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M4 12h2M8 8v8M12 5v14M16 8v8M20 12h0" />
        </svg>
      </span>
      <span className="font-display text-[1.15rem] font-semibold tracking-tight">Rehearse</span>
    </Link>
  );
}

import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Room } from "@/components/Room";
import { getSession } from "@/lib/auth/session";
import { getInterview, NotFoundError } from "@/lib/interview/service";
import { LEVEL_LABELS, ROLE_LABELS, type Level, type Role } from "@/lib/interview/types";

export const metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InterviewPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let data;
  try {
    data = await getInterview(s.sub, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { interview, turns } = data;
  if (interview.status === "completed" || !interview.currentQuestion) redirect(`/report/${id}`);
  return (
    <>
      <AppHeader />
      <main className="px-4 py-8 sm:px-6 sm:py-12">
        <Room
          id={id}
          title={`${LEVEL_LABELS[interview.level as Level]} ${ROLE_LABELS[interview.role as Role]}`}
          provider={interview.provider}
          total={interview.totalQuestions}
          answered={turns.length}
          question={interview.currentQuestion}
        />
      </main>
    </>
  );
}

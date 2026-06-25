/**
 * "+ Add client" form — super-admin only.
 *
 * Step 1 of the onboarding flow. Creates the `clients` row, then redirects
 * to /<slug>/admin where the setup checklist guides the rest (credentials,
 * pipeline, access, first ETL run).
 */
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, resolveAccess } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/user-menu";
import { ProgressLink } from "@/components/progress-link";
import { NewClientForm } from "./new-client-form";

export const runtime = "edge";

export default async function NewClientPage() {
  const user = await getCurrentUser();
  if (!user || !user.email) redirect("/login");

  const access = await resolveAccess(user.email);
  // Hard gate to super-admin. Regular admin can browse clients but not
  // create them — onboarding is a privileged op (touches all clients).
  if (access.kind !== "super_admin") {
    if (access.kind === "admin") redirect("/clients");
    if (access.kind === "client_user") redirect(`/${access.client.slug}/home`);
    redirect("/no-access");
  }

  return (
    <>
      <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-6 lg:px-12 h-16 flex items-center justify-between gap-6">
          <Logo size={28} />
          <UserMenu email={user.email} />
        </div>
      </header>

      <main className="w-full max-w-[640px] mx-auto px-6 py-10 flex flex-col gap-8">
        <div>
          <ProgressLink
            href="/clients"
            className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4 transition-colors"
          >
            <ArrowLeft size={14} />
            Back to clients
          </ProgressLink>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
            Admin
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Add a client
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1.5">
            Create the client row. You&apos;ll finish setup (credentials, pipeline,
            access, ETL) on the next screen.
          </p>
        </div>

        <NewClientForm />
      </main>
    </>
  );
}

/**
 * Relay staff landing page — list of every client, grouped by
 * lifecycle status.
 *
 *   - Active — the normal working set, shown first. Includes the
 *     "+ Add client" card (super-admin only) as a trailing entry.
 *   - Paused — collapsed if empty, otherwise shown beneath Active.
 *   - Deleted — collapsed if empty. Soft-deleted clients live here;
 *     this is the only surface where they're visible. From here you
 *     can restore them or permanently delete them via /admin.
 *
 * Non-active sections are styled slightly muted (lower opacity, no
 * yellow hover) so the active set stays the visual focal point.
 *
 * Client users never reach this page — they're redirected to their
 * own slug at the top.
 */
import { redirect } from "next/navigation";
import { ChevronRight, Pause, Trash2 } from "lucide-react";
import { getCurrentUser, resolveAccess } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/components/user-menu";
import { ProgressLink } from "@/components/progress-link";
import { ClientLogo } from "@/components/client-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AddClientExplainerCard } from "@/components/admin/add-client-explainer-card";
import { SecurityLabBanner } from "@/components/security/security-lab-banner";
import type { ResolvedClient, ClientStatus, Service } from "@/lib/auth";

/** Short label for each entitled service, shown as compact chips on the client
 *  card so staff see at a glance what each client is signed up for. Kept short
 *  (`web`→"Web", `seo`→"SEO", the Local-SEO upsell) so all 1–4 chips fit on a
 *  single row at every card width — keeping every card the same height. */
const SERVICE_CHIP: Record<Service, string> = {
  ads: "Ads",
  socials: "Socials",
  web: "Web",
  seo: "SEO",
};

export default async function ClientsPage() {
  const user = await getCurrentUser();
  if (!user || !user.email) redirect("/login");

  const access = await resolveAccess(user.email);
  if (access.kind === "no_access") redirect("/no-access");
  if (access.kind === "client_user") redirect(`/${access.client.slug}/home`);

  const clients = access.allClients;
  // Only super-admin gets the "+ Add client" entry point. Regular admin
  // can browse + view dashboards but onboarding new clients is a
  // privileged op (touches every client's access surface).
  const canCreate = access.kind === "super_admin";

  // Partition by status. Already alphabetical from loadAllClientsForAdmin,
  // so within each bucket the order is stable.
  const active = clients.filter((c) => c.status === "active");
  const paused = clients.filter((c) => c.status === "paused");
  const deleted = clients.filter((c) => c.status === "deleted");

  return (
    <>
      <header className="border-b border-[var(--surface-3)]/60 bg-[var(--surface-0)]/95 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-6 lg:px-12 h-16 flex items-center justify-between gap-6">
          <Logo size={28} />
          <div className="flex items-center gap-3 md:gap-4">
            <ThemeToggle />
            <UserMenu email={user.email} />
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1100px] mx-auto px-6 lg:px-12 py-12 flex flex-col gap-10">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
            Admin
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Clients
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1.5">
            Pick a client to view their dashboard.
          </p>
        </div>

        {/* Security Lab — public interactive attack/defense demos. */}
        <SecurityLabBanner />

        {/* ── Active ────────────────────────────────────────────────────── */}
        <Section
          title="Active"
          count={active.length}
          showEmpty={active.length === 0 && !canCreate}
          emptyMessage="No active clients yet."
        >
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.map((c) => (
              <ClientCard key={c.id} client={c} />
            ))}
            {/* "+ Add client" lives in the Active section so it sits with
                the working set rather than at the very bottom under
                Deleted, where a super-admin would have to scroll past
                everything to reach it. Super-admin only. */}
            {canCreate && <AddClientExplainerCard />}
          </ul>
        </Section>

        {/* ── Paused ────────────────────────────────────────────────────── */}
        {paused.length > 0 && (
          <Section
            title="Paused"
            count={paused.length}
            icon={<Pause size={12} />}
            hint="Frozen for now. ETL pulls are skipped, the client's users can't sign in."
          >
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {paused.map((c) => (
                <ClientCard key={c.id} client={c} dim />
              ))}
            </ul>
          </Section>
        )}

        {/* ── Deleted ───────────────────────────────────────────────────── */}
        {deleted.length > 0 && (
          <Section
            title="Deleted"
            count={deleted.length}
            icon={<Trash2 size={12} />}
            hint="Soft-deleted. Data is preserved — restore from /admin, or permanently delete."
          >
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {deleted.map((c) => (
                <ClientCard key={c.id} client={c} dim />
              ))}
            </ul>
          </Section>
        )}
      </main>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Section({
  title,
  count,
  icon,
  hint,
  showEmpty,
  emptyMessage,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  hint?: string;
  showEmpty?: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)] font-medium">
          {icon}
          {title}
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">{count}</div>
      </div>
      {hint && (
        <p className="text-[12px] text-[var(--text-tertiary)] -mt-2 max-w-prose">{hint}</p>
      )}
      {showEmpty ? (
        <div className="bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-10 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            {emptyMessage ?? "Nothing here yet."}
          </p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function ClientCard({
  client: c,
  dim,
}: {
  client: ResolvedClient;
  dim?: boolean;
}) {
  return (
    <li>
      <ProgressLink
        href={`/${c.slug}/home`}
        className={
          "block bg-[var(--surface-1)] border border-[var(--surface-3)]/40 rounded-[var(--radius-card)] p-6 transition-all group " +
          (dim
            ? "opacity-70 hover:opacity-100 hover:border-[var(--surface-3)] hover:bg-[var(--surface-2)]/40"
            : "hover:border-[var(--ps-yellow)]/60 hover:bg-[var(--surface-2)]")
        }
      >
        <div className="flex items-center gap-4">
          <ClientLogo client={c} size={44} />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                Client
              </div>
              {c.status !== "active" && <StatusPill status={c.status} />}
            </div>
            <div className="text-lg font-semibold text-[var(--text-primary)] truncate">
              {c.name}
            </div>
            <div className="text-[11px] text-[var(--text-tertiary)] truncate">
              /{c.slug}
            </div>
            {/* Entitled services — at-a-glance "what is this client in for".
                flex-nowrap + shrinkable chips so 1–4 services always sit on ONE
                row (cards stay equal height); chips truncate before they'd wrap. */}
            {c.enabled_services.length > 0 && (
              <div className="flex flex-nowrap items-center gap-1 mt-1.5">
                {c.enabled_services.map((s) =>
                  SERVICE_CHIP[s] ? (
                    <span
                      key={s}
                      className="min-w-0 truncate text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--surface-2)] border border-[var(--surface-3)]/50 text-[var(--text-secondary)]"
                    >
                      {SERVICE_CHIP[s]}
                    </span>
                  ) : null,
                )}
              </div>
            )}
          </div>
          <ChevronRight
            size={18}
            className="text-[var(--text-tertiary)] group-hover:text-[var(--accent-fg)] transition-colors shrink-0"
          />
        </div>
      </ProgressLink>
    </li>
  );
}

function StatusPill({ status }: { status: ClientStatus }) {
  const cfg: Record<ClientStatus, string> = {
    active: "",
    paused: "text-[var(--text-secondary)] border-[var(--surface-3)]/80 bg-[var(--surface-2)]",
    deleted: "text-[var(--negative)] border-[var(--negative)]/40 bg-[var(--negative)]/10",
  };
  if (status === "active") return null;
  return (
    <span
      className={
        "text-[9px] uppercase tracking-wider px-1.5 py-px rounded-md border font-medium " +
        cfg[status]
      }
    >
      {status}
    </span>
  );
}

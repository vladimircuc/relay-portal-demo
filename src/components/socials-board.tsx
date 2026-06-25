/**
 * Layout wrapper for the /socials body.
 *
 * Unlike /ads, Socials has no Simple/Advanced split — it always shows the full
 * board: the core sections (metric tiles + trend chart + Top performing
 * content) followed by the deep-dive sections (platform breakdown, posting
 * cadence + content mix, content library). Only the period picker sits on top.
 *
 * (Previously this carried a Simple/Advanced toggle mirroring /ads; that was
 * removed — Socials is advanced-only now.)
 */

export function SocialsBoard({
  picker,
  core,
  details,
}: {
  picker: React.ReactNode;
  core: React.ReactNode;
  details: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      {/* Control bar — just the period picker now (no view toggle). */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full md:w-auto">
          <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)] mb-2">
            Period
          </div>
          {picker}
        </div>
      </div>

      {core}
      {details}
    </div>
  );
}

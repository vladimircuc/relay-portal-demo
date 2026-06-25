/**
 * Display helpers for per-client funnel stage labels.
 *
 * Pluralisation rule: "add 's' after the first word."
 *
 *   Booking         → Bookings
 *   Quote Sent      → Quotes Sent
 *   Consult Held    → Consults Held
 *   Discovery Booked → Discoverys Booked  ← (rare, agency edits manually)
 *
 * This handles the overwhelming majority of real labels we see. For the
 * occasional irregular case (Discovery → Discoveries, Inquiry → Inquiries),
 * the agency either picks a label that pluralises cleanly, or we patch
 * the specific client by editing the singular in /admin to something
 * that works under this rule.
 *
 * Why the rule lives here, not in the DB: the canonical stored value is
 * always the singular. Plural is purely a rendering concern.
 */
export function pluralize(label: string): string {
  const trimmed = label.trim();
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return trimmed + "s";
  return trimmed.slice(0, spaceIdx) + "s" + trimmed.slice(spaceIdx);
}

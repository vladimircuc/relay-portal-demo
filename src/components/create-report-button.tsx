"use client";

/**
 * "Create Report" header button. In the live product this opens a service/date
 * picker and exports a branded PDF; the demo opens a "how it works" explainer
 * (PDF render + SSRF-guarded image egress) instead of generating a file.
 */
import { FileText } from "lucide-react";
import { HowItWorks } from "@/components/how-it-works";
import type { Service } from "@/lib/auth";

type Props = {
  client: { id: string; slug: string; name: string };
  /** The client's enabled_services — part of the production contract. */
  services: Service[];
};

export function CreateReportButton({ client }: Props) {
  return (
    <HowItWorks
      title="The PDF report builder, in production"
      Icon={FileText}
      intro={`The live product exports a branded PDF for ${client.name} over a chosen date range and set of services. Here's how it's generated.`}
      steps={[
        { title: "Server-side render", body: "A POST to /api/report/<clientId> renders the report with headless Chromium on the server and streams back a PDF — the browser only downloads the finished file." },
        { title: "Scoped to entitlements", body: "Only the services this client owns (Ads / Social / Web & SEO) can be included, and the date range is validated server-side before any data is gathered." },
      ]}
      security={{ body: "Client-supplied fields like the business name are escaped for HTML attribute context before they reach the renderer, and any logo the template fetches goes through an SSRF guard: private, link-local and cloud-metadata hosts are blocked, and the session cookie is only ever forwarded to our own origin." }}
      footnote="Demo — no PDF is generated."
    >
      {(open) => (
        <button
          type="button"
          onClick={open}
          title="How report generation works"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--ps-yellow)] px-3.5 text-sm font-semibold text-[var(--text-on-yellow)] transition-[filter] hover:brightness-95"
        >
          <FileText size={15} strokeWidth={2.4} />
          <span className="hidden md:inline">Create Report</span>
        </button>
      )}
    </HowItWorks>
  );
}

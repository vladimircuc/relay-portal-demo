import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/demo-data";
import { ClientTabs } from "@/components/tabs";

export default async function ClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = getClient(slug);
  if (!client) notFound();

  const tabs = [
    { href: "", label: "Overview" },
    ...(client.services.includes("ads") ? [{ href: "/ads", label: "Paid Ads" }] : []),
    ...(client.services.includes("socials") ? [{ href: "/socials", label: "Social" }] : []),
    { href: "/connect", label: "Connect" },
    { href: "/security", label: "Security Lab" },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="h-3 w-3 rounded-full" style={{ background: client.accent }} />
        <h1 className="text-xl font-semibold tracking-tight">{client.name}</h1>
        <span className="text-sm text-dim">{client.industry}</span>
      </div>
      <ClientTabs slug={slug} tabs={tabs} />
      <div className="pt-6">{children}</div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { getClient } from "@/lib/demo-data";
import { VaultRevokeDemo } from "@/components/demos/vault-revoke";
import { RlsProbeDemo } from "@/components/demos/rls-probe";

export default async function SecurityLab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getClient(slug);
  if (!c) notFound();

  return (
    <div className="grid gap-6">
      <div>
        <p className="kicker">security lab</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight">Try the attack. Watch the defense hold.</h2>
        <p className="mt-1 max-w-2xl text-sm text-dim">
          Live, in your browser — no backend. These reproduce real defenses from how Relay was built, including one
          real vulnerability an audit caught and I fixed.
        </p>
      </div>
      <VaultRevokeDemo />
      <RlsProbeDemo />
    </div>
  );
}

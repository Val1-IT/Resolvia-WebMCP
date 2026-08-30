import { PartnerPortal } from "@/src/ui/components/partner-portal";

export const dynamic = "force-dynamic";

export default async function PartnerRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  return <PartnerPortal requestId={requestId} />;
}
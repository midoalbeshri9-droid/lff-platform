import { requireOfficialUser } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { PortalList } from "@/components/PortalList";

export default async function History() {
  const u = await requireOfficialUser();
  return (<><PageHead title="مبارياتي السابقة" /><PortalList officialId={u.officialId} past /></>);
}

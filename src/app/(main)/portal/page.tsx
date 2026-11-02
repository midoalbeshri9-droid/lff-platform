import { requireOfficialUser } from "@/lib/auth";
import { OFFICIAL_TYPE } from "@/lib/labels";
import { PortalList } from "@/components/PortalList";

export default async function Portal() {
  const u = await requireOfficialUser();
  return (
    <>
      <div className="portal-hero"><h1 style={{ margin: 0 }}>مرحبًا، {u.fullName}</h1><small>{OFFICIAL_TYPE[u.officialType ?? "REFEREE"]} — تعييناتك المعتمدة من لجنة الحكام</small></div>
      <PortalList officialId={u.officialId} past={false} />
    </>
  );
}

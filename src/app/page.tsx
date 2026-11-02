import { redirect } from "next/navigation";
import { getCurrentUser, homeFor } from "@/lib/auth";

export default async function Root() {
  const u = await getCurrentUser();
  redirect(u ? homeFor(u) : "/login");
}

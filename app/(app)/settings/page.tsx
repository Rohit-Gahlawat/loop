import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/auth";
import { PageHeader } from "../_components/page-header";
import { Members } from "./_members";

export default async function SettingsPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const members = await prisma.user.findMany({
    where: { workspaceId: principal.workspaceId },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <>
      <PageHeader title="Settings" description="Members and their roles in this workspace." />
      <Members members={members} currentUserId={principal.userId} isAdmin={principal.role === Role.ADMIN} />
    </>
  );
}

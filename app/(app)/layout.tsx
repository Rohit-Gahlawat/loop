import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Nav } from "./_components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const workspace = await prisma.workspace.findUnique({
    where: { id: principal.workspaceId },
    select: { name: true },
  });

  return (
    <div className="min-h-screen">
      <Nav name={principal.name} role={principal.role} workspace={workspace?.name ?? "Workspace"} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

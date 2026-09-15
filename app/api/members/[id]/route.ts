import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest, handler, notFound, ok, parseJson } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";

const updateRoleSchema = z.object({ role: z.nativeEnum(Role) });

type Params = { params: { id: string } };

export const PATCH = handler<Params>(async (req, { params }) => {
  const { workspaceId, userId } = await requireAdmin();
  const { role } = await parseJson(req, updateRoleSchema);

  // Scoped by workspaceId, so an admin cannot reach a member of another workspace.
  const member = await prisma.user.findFirst({
    where: { id: params.id, workspaceId },
    select: { id: true, role: true },
  });
  if (!member) throw notFound("That member is not in your workspace.");

  if (member.id === userId && role !== Role.ADMIN) {
    throw badRequest("You cannot remove your own admin access.");
  }

  if (member.role === Role.ADMIN && role !== Role.ADMIN) {
    const admins = await prisma.user.count({ where: { workspaceId, role: Role.ADMIN } });
    if (admins <= 1) throw badRequest("A workspace must keep at least one admin.");
  }

  const updated = await prisma.user.update({
    where: { id: member.id },
    data: { role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return ok(updated);
});

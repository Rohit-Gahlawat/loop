import { z } from "zod";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest, handler, ok, parseJson } from "@/lib/api";
import { requireAdmin, requireSession } from "@/lib/auth";

const memberSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} as const;

export const GET = handler(async () => {
  const { workspaceId } = await requireSession();

  const members = await prisma.user.findMany({
    where: { workspaceId },
    select: memberSelect,
    orderBy: { createdAt: "asc" },
  });

  return ok(members);
});

const createMemberSchema = z.object({
  name: z.string().trim().min(1, "A name is required.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  role: z.nativeEnum(Role),
});

export const POST = handler(async (req) => {
  const { workspaceId } = await requireAdmin();
  const input = await parseJson(req, createMemberSchema);

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw badRequest("An account with that email already exists.");

  const member = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role,
      workspaceId,
    },
    select: memberSelect,
  });

  return ok(member, 201);
});

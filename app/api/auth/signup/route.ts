import { z } from "zod";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { badRequest, handler, ok, parseJson } from "@/lib/api";

const signupSchema = z.object({
  name: z.string().trim().min(1, "Your name is required.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Use at least 8 characters."),
  workspaceName: z.string().trim().min(1, "Give your workspace a name.").max(80),
});

/** Creates a workspace and its first user. The creator becomes ADMIN. */
export const POST = handler(async (req) => {
  const { name, email, password, workspaceName } = await parseJson(req, signupSchema);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw badRequest("An account with that email already exists.");

  const user = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({ data: { name: workspaceName } });
    return tx.user.create({
      data: {
        name,
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: Role.ADMIN,
        workspaceId: workspace.id,
      },
      select: { id: true, name: true, email: true, role: true, workspaceId: true },
    });
  });

  return ok(user, 201);
});

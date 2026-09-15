import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { prisma } from "./db";
import { forbidden, unauthorized } from "./api";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          workspaceId: user.workspaceId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.workspaceId = user.workspaceId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.workspaceId = token.workspaceId;
      }
      return session;
    },
  },
};

/** The authenticated caller. Every tenant-scoped query filters on `workspaceId`. */
export type Principal = {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  name: string;
};

export async function getPrincipal(): Promise<Principal | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.workspaceId) return null;

  return {
    userId: session.user.id,
    workspaceId: session.user.workspaceId,
    role: session.user.role,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
  };
}

/**
 * Use at the top of every protected route handler.
 * Throws a 401 that `handler` converts to JSON.
 */
export async function requireSession(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) throw unauthorized();
  return principal;
}

/** Server-side role check. Hiding a button in the UI is not access control. */
export async function requireRole(...allowed: Role[]): Promise<Principal> {
  const principal = await requireSession();
  if (!allowed.includes(principal.role)) throw forbidden();
  return principal;
}

/** Anyone who may change data: admins and analysts. Viewers are read-only. */
export const requireWrite = () => requireRole(Role.ADMIN, Role.ANALYST);

/** Workspace administration: members and roles. */
export const requireAdmin = () => requireRole(Role.ADMIN);

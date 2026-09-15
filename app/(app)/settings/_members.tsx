"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

const roles = [Role.ADMIN, Role.ANALYST, Role.VIEWER];

const roleHelp: Record<Role, string> = {
  ADMIN: "Manages members and roles.",
  ANALYST: "Ingests and manages feedback.",
  VIEWER: "Read-only access.",
};

export function Members({
  members,
  currentUserId,
  isAdmin,
}: {
  members: Member[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: Role.VIEWER as Role });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(url: string, method: string, body: unknown) {
    setError(null);
    setBusy(true);
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error?.message ?? "That did not work.");
      return false;
    }

    router.refresh();
    return true;
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (await send("/api/members", "POST", form)) {
      setForm({ name: "", email: "", password: "", role: Role.VIEWER });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Members" description="Everyone with access to this workspace." />
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <Td className="font-medium text-slate-900">
                  {member.name}
                  {member.id === currentUserId ? <span className="ml-2 text-xs text-slate-400">you</span> : null}
                </Td>
                <Td>{member.email}</Td>
                <Td>
                  {isAdmin ? (
                    <Select
                      aria-label={`Role for ${member.name}`}
                      className="h-8 w-36"
                      value={member.role}
                      disabled={busy}
                      onChange={(e) => send(`/api/members/${member.id}`, "PATCH", { role: e.target.value })}
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    member.role
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {isAdmin ? (
        <Card>
          <CardHeader title="Add a member" description="They can sign in with these details straight away." />
          <CardBody>
            <form onSubmit={addMember} className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="member-name">
                <Input
                  id="member-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>

              <Field label="Email" htmlFor="member-email">
                <Input
                  id="member-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>

              <Field label="Temporary password" htmlFor="member-password" hint="At least 8 characters.">
                <Input
                  id="member-password"
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>

              <Field label="Role" htmlFor="member-role" hint={roleHelp[form.role]}>
                <Select
                  id="member-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </Select>
              </Field>

              {error ? (
                <p role="alert" className="text-sm text-red-600 sm:col-span-2">
                  {error}
                </p>
              ) : null}

              <div className="sm:col-span-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Adding" : "Add member"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

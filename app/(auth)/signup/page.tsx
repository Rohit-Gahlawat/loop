"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", workspaceName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "We could not create your workspace.");
      setSubmitting(false);
      return;
    }

    await signIn("credentials", { email: form.email, password: form.password, redirect: false });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardBody className="space-y-5 p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Create your workspace</h1>
          <p className="mt-1 text-sm text-slate-500">You will be its first administrator.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Your name" htmlFor="name">
            <Input id="name" required value={form.name} onChange={update("name")} />
          </Field>

          <Field label="Workspace name" htmlFor="workspaceName" hint="Usually your company name.">
            <Input id="workspaceName" required value={form.workspaceName} onChange={update("workspaceName")} />
          </Field>

          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={form.email} onChange={update("email")} />
          </Field>

          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={update("password")}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating" : "Create workspace"}
          </Button>
        </form>

        <p className="text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-indigo-600 hover:text-indigo-700">
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}

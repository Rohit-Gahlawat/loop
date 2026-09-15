"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const result = await signIn("credentials", { email, password, redirect: false });

    if (result?.error) {
      setError("That email and password do not match an account.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardBody className="space-y-5 p-6">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Welcome back.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in" : "Sign in"}
          </Button>
        </form>

        <p className="text-sm text-slate-500">
          No workspace yet?{" "}
          <Link href="/signup" className="font-medium text-indigo-600 hover:text-indigo-700">
            Create one
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}

import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/auth";

export default async function Home() {
  const principal = await getPrincipal();
  redirect(principal ? "/dashboard" : "/login");
}

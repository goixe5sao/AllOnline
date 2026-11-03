"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
  }

  return <button className="text-button" onClick={signOut}>Đăng xuất</button>;
}

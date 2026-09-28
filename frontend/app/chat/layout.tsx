import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BACKEND_URL } from "@/lib/config";
import { SessionSidebar } from "@/components/SessionSidebar";

async function getchats() {
  const cookieStore = await cookies();
  const res = await fetch(`${BACKEND_URL}/api/chats`, {
    headers: { Cookie: cookieStore.toString() },
    cache: "no-store",
  });
  if (!res.ok) redirect("/signin");
  const chats = await res.json();

  return chats.sort(
    (a: { created_at: string }, b: { created_at: string }) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

async function getCurrentUser() {
  const cookieStore = await cookies();

  const res = await fetch(`${BACKEND_URL}/api/users/me`, {
    headers: {
      Cookie: cookieStore.toString(),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    return null;
  }

  return res.json();
}

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const chats = await getchats();
  const user = await getCurrentUser();

  return (
    <div className="flex h-screen">
      <SessionSidebar sessions={chats} userName={user?.name ?? user?.username ?? "User"}/>
      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
}
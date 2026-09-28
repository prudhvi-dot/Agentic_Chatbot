"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  PlusIcon,
  Loader2Icon,
  Trash2,
  UserIcon,
} from "lucide-react";
import { LogoutButton } from "./LogoutButton";

type Session = {
  id: string;
  title: string;
};

export function SessionSidebar({
  sessions,
  userName
}: {
  sessions: Session[];
  userName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleNewChat() {
    const chatId = crypto.randomUUID();
    router.push(`/chat/${chatId}`);
    router.refresh();
  }

  function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

  async function handleDeleteChat(sessionId: string) {
    const isCurrentChat = pathname === `/chat/${sessionId}`;
    setDeletingId(sessionId);
    setError(null);

    try {
      const res = await fetch(`/api/backend/chats/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      if (!res.ok) {
        setError("Failed to delete chat");
        return;
      }

      if (isCurrentChat) {
        router.push("/chat");
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">

      {/* ==================================================
          TOP
      ================================================== */}

      

      <div className="px-2 py-3">

        {/* New Chat */}

        <div className="mb-2 flex items-center justify-between px-3">

        <h1>Agentic Chatbot</h1>
        </div>

        <button
          type="button"
          onClick={handleNewChat}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-sidebar-accent"
        >
          <PlusIcon className="h-[18px] w-[18px] shrink-0" />

          <span>New chat</span>
        </button>

      </div>

      {/* ==================================================
          CHAT HISTORY
      ================================================== */}

      <div className="px-2 pb-2">

        <p className="px-3 py-2 text-xs font-medium text-muted-foreground">
          Chats
        </p>

      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2">

        {error && (
          <p className="px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {sessions.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            No chats yet.
          </p>
        ) : (
          <div className="space-y-0.5">

            {sessions.map((session) => {
              const isActive =
                pathname === `/chat/${session.id}`;

              const isDeleting =
                deletingId === session.id;

              return (
                <div
                  key={session.id}
                  className={`group relative flex min-w-0 items-center rounded-lg transition-colors ${
                    isActive
                      ? "bg-sidebar-accent"
                      : "hover:bg-sidebar-accent/70"
                  }`}
                >

                  {/* Chat */}

                  <Link
                    href={`/chat/${session.id}`}
                    className="min-w-0 flex-1 truncate px-3 py-2.5 text-[13px]"
                  >
                    {session.title}
                  </Link>

                  {/* Delete */}

                  <button
                    type="button"
                    disabled={deletingId !== null}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteChat(session.id);
                    }}
                    className="mr-1.5 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-50"
                    aria-label={`Delete ${session.title}`}
                  >
                    {isDeleting ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>

                </div>
              );
            })}

          </div>
        )}

      </nav>

       <div className="border-t border-border p-2">

        <div className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-sidebar-accent">

          {/* User Icon */}

          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">
            {userName ? (
              getInitials(userName)
            ) : (
              <UserIcon className="h-4 w-4" />
            )}
          </div>

          {/* Username */}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {userName}
            </p>
          </div>

          {/* Logout */}

          <LogoutButton />

        </div>
        </div>

    </aside>
  );
}
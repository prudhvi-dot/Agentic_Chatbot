"use client";

import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";

const Home = () => {
  const router = useRouter();

  function handleNewChat() {
    router.push(`/chat/${crypto.randomUUID()}`);
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-2xl text-center">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background">
            <span className="text-xl font-semibold">AI</span>
          </div>

          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            How can I help you?
          </h1>

          <p className="mt-3 text-sm text-muted-foreground">
            Ask anything, search the web, or work with your documents.
          </p>

          <button
            type="button"
            onClick={handleNewChat}
            className="mx-auto mt-8 flex items-center gap-2 rounded-xl border border-border bg-background px-5 py-3 text-sm font-medium transition-colors hover:bg-muted"
          >
            <PlusIcon className="h-4 w-4" />
            New chat
          </button>
        </div>
      </div>

      <div className="pb-4 text-center">
        <p className="text-[11px] text-muted-foreground">
          Agentic AI can make mistakes. Check important information.
        </p>
      </div>
    </main>
  );
};

export default Home;
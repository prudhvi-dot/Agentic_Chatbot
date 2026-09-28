"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";

const Page = () => {
  const router = useRouter();

  useEffect(() => {
    const chatId = crypto.randomUUID();
    router.replace(`/chat/${chatId}`);
  }, [router]);

  return (
    <div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card">
        <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <div className="text-center">
        <p className="text-sm font-medium">Creating your chat...</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This will only take a moment.
        </p>
      </div>
    </div>
  );
};

export default Page;
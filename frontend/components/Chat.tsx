"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Loader2Icon,
  BotIcon,
  PaperclipIcon,
  XIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRouter } from "next/navigation";

export type Message = {
  id?: string;
  role: "human" | "ai";
  message: string;
  created_at: string;
};

type ChatProps = {
  docId: string;
  userName: string;
  initialMessages: Message[];
};

const Chat = ({
  docId,
  userName,
  initialMessages,
}: ChatProps) => {
  const [isPending, startTransition] = useTransition();

  const [messages, setMessages] =
    useState<Message[]>(initialMessages);

  const [input, setInput] = useState("");

  const [selectedFile, setSelectedFile] =
    useState<File | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  const [toolStatus, setToolStatus] =
    useState<string | null>(null);

  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const divRef =
    useRef<HTMLDivElement>(null);

  const hasMessagesRef =
    useRef(initialMessages.length > 0);

  const router = useRouter();

  useEffect(() => {
    divRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, toolStatus]);


  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    setError(null);
    setSelectedFile(file);
  }


  function removeSelectedFile() {
    setSelectedFile(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }


  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const question = input.trim();

    if (
      (!question && !selectedFile) ||
      isPending
    ) {
      return;
    }

    const isFirstMessage =
      !hasMessagesRef.current;

    setInput("");
    setError(null);

    setToolStatus(
      "Analyzing your question..."
    );

    if (question) {
      setMessages((prev) => [
        ...prev,
        {
          role: "human",
          message: question,
          created_at:
            new Date().toISOString(),
        },
      ]);
    }


    if (selectedFile) {
      setMessages((prev) => [
        ...prev,
        {
          role: "human",
          message: `📎 ${selectedFile.name}`,
          created_at:
            new Date().toISOString(),
        },
      ]);
    }

    startTransition(async () => {
      try {
        const formData = new FormData();

        // Message
        formData.append(
          "message",
          question
        );

        // File
        if (selectedFile) {
          formData.append(
            "file",
            selectedFile
          );
        }

        const res = await fetch(
          `/api/backend/chats/${docId}/send`,
          {
            method: "POST",
            credentials: "include",
            body: formData,
          }
        );

        // Clear file after request has successfully started.
        setSelectedFile(null);

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }

        if (!res.ok) {
          let errorMessage =
            `Request failed with status ${res.status}`;

          try {
            const errorData =
              await res.json();

            if (errorData.detail) {
              errorMessage =
                typeof errorData.detail ===
                "string"
                  ? errorData.detail
                  : JSON.stringify(
                      errorData.detail
                    );
            }
          } catch {
            // Ignore JSON parsing error
          }

          throw new Error(
            errorMessage
          );
        }

        if (!res.body) {
          throw new Error(
            "Streaming response is not available."
          );
        }

        const reader =
          res.body.getReader();

        const decoder =
          new TextDecoder();

        let buffer = "";

        let accumulatedMessage = "";

        let aiMessageCreated = false;

        while (true) {
          const {
            value,
            done,
          } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(
            value,
            {
              stream: true,
            }
          );

          const lines =
            buffer.split("\n");

          buffer =
            lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }

            let data;

            try {
              data = JSON.parse(line);
            } catch (error) {
              console.error(
                "Failed to parse stream chunk:",
                line,
                error
              );

              continue;
            }

            // --------------------------------------------------
            // STATUS
            // --------------------------------------------------

            if (
              data.type === "status"
            ) {
              setToolStatus(
                data.message ??
                  "Analyzing your question..."
              );

              continue;
            }

            if (
              data.type === "token"
            ) {
              setToolStatus(null);

              if (!aiMessageCreated) {
                aiMessageCreated = true;

                setMessages(
                  (prev) => [
                    ...prev,
                    {
                      role: "ai",
                      message: "",
                      created_at:
                        new Date().toISOString(),
                    },
                  ]
                );
              }

              accumulatedMessage +=
                data.content;

              setMessages((prev) => {
                const updated = [...prev];

                const lastIndex =
                  updated.length - 1;

                if (
                  lastIndex >= 0 &&
                  updated[lastIndex]
                    .role === "ai"
                ) {
                  updated[lastIndex] = {
                    ...updated[lastIndex],
                    message:
                      accumulatedMessage,
                  };
                }

                return updated;
              });

              continue;
            }


            if (
              data.type === "final"
            ) {
              setToolStatus(null);

              accumulatedMessage =
                data.content ?? "";

              if (!aiMessageCreated) {
                aiMessageCreated = true;

                setMessages(
                  (prev) => [
                    ...prev,
                    {
                      role: "ai",
                      message:
                        accumulatedMessage,
                      created_at:
                        new Date().toISOString(),
                    },
                  ]
                );
              } else {
                setMessages(
                  (prev) => {
                    const updated =
                      [...prev];

                    const lastIndex =
                      updated.length - 1;

                    if (
                      lastIndex >= 0 &&
                      updated[lastIndex]
                        .role === "ai"
                    ) {
                      updated[
                        lastIndex
                      ] = {
                        ...updated[
                          lastIndex
                        ],
                        message:
                          accumulatedMessage,
                      };
                    }

                    return updated;
                  }
                );
              }

              continue;
            }


            if (
              data.type === "error"
            ) {
              setToolStatus(null);

              throw new Error(
                data.message ||
                  "Failed to generate response."
              );
            }
          }
        }


        buffer += decoder.decode();

        if (buffer.trim()) {
          try {
            const data =
              JSON.parse(buffer);


            if (
              data.type === "status"
            ) {
              setToolStatus(
                data.message ??
                  "Analyzing your question..."
              );
            }


            if (
              data.type === "token"
            ) {
              setToolStatus(null);

              if (!aiMessageCreated) {
                aiMessageCreated = true;

                setMessages(
                  (prev) => [
                    ...prev,
                    {
                      role: "ai",
                      message: "",
                      created_at:
                        new Date().toISOString(),
                    },
                  ]
                );
              }

              accumulatedMessage +=
                data.content;

              setMessages(
                (prev) => {
                  const updated =
                    [...prev];

                  const lastIndex =
                    updated.length - 1;

                  if (
                    lastIndex >= 0 &&
                    updated[lastIndex]
                      .role === "ai"
                  ) {
                    updated[
                      lastIndex
                    ] = {
                      ...updated[
                        lastIndex
                      ],
                      message:
                        accumulatedMessage,
                    };
                  }

                  return updated;
                }
              );
            }


            if (
              data.type === "final"
            ) {
              setToolStatus(null);

              accumulatedMessage =
                data.content ?? "";

              if (!aiMessageCreated) {
                aiMessageCreated = true;

                setMessages(
                  (prev) => [
                    ...prev,
                    {
                      role: "ai",
                      message:
                        accumulatedMessage,
                      created_at:
                        new Date().toISOString(),
                    },
                  ]
                );
              } else {
                setMessages(
                  (prev) => {
                    const updated =
                      [...prev];

                    const lastIndex =
                      updated.length - 1;

                    if (
                      lastIndex >= 0 &&
                      updated[lastIndex]
                        .role === "ai"
                    ) {
                      updated[
                        lastIndex
                      ] = {
                        ...updated[
                          lastIndex
                        ],
                        message:
                          accumulatedMessage,
                      };
                    }

                    return updated;
                  }
                );
              }
            }


            if (
              data.type === "error"
            ) {
              setToolStatus(null);

              throw new Error(
                data.message ||
                  "Failed to generate response."
              );
            }
          } catch (error) {
            if (
              error instanceof
              SyntaxError
            ) {
              console.error(
                "Failed to parse final stream data:",
                buffer
              );
            } else {
              throw error;
            }
          }
        }


        setToolStatus(null);


        if (isFirstMessage) {
          hasMessagesRef.current = true;
          router.refresh();
        }

      } catch (error) {
        console.error(
          "Chat error:",
          error
        );

        setToolStatus(null);

        setError(
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again."
        );


        setMessages((prev) => {
          const lastMessage =
            prev[prev.length - 1];

          if (
            lastMessage?.role === "ai" &&
            !lastMessage.message
          ) {
            return prev.slice(0, -1);
          }

          return prev;
        });
      }
    });
  }


  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">


      <div className="flex-1 overflow-y-auto">

        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">

          {messages.length === 0 ? (
            <div className="flex min-h-[60vh] items-center justify-center">

              <div className="text-center">

                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card">
                  <BotIcon className="h-6 w-6" />
                </div>

                <h2 className="text-2xl font-semibold">
                  How can I help you?
                </h2>

                <p className="mt-2 text-sm text-muted-foreground">
                  Ask me anything.
                </p>

              </div>

            </div>
          ) : (
            <div className="space-y-8">

              {messages.map((msg, idx) => (
                <div
                  key={msg.id ?? idx}
                  className={`flex w-full ${
                    msg.role === "human"
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >


                  {msg.role === "human" ? (
                    <div className="flex max-w-[80%] flex-col items-end">

                      <div className="rounded-3xl bg-secondary px-4 py-3 text-sm text-secondary-foreground">

                        <div className="whitespace-pre-wrap break-words">
                          {msg.message}
                        </div>

                      </div>

                      {msg.message && (
                        <span className="mt-1 px-2 text-[10px] text-muted-foreground">
                          {new Date(
                            msg.created_at
                          ).toLocaleTimeString(
                            [],
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                      )}

                    </div>
                  ) : (


                    <div className="w-full">

                      <div className="flex items-start gap-3">

                        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <BotIcon className="h-4 w-4" />
                        </div>

                        <div className="min-w-0 flex-1 text-sm leading-7">

                          <ReactMarkdown
                            remarkPlugins={[
                              remarkGfm,
                            ]}
                            components={{
                              p: ({
                                children,
                              }) => (
                                <p className="mb-4 last:mb-0">
                                  {children}
                                </p>
                              ),

                              h1: ({
                                children,
                              }) => (
                                <h1 className="mb-4 mt-6 text-2xl font-semibold">
                                  {children}
                                </h1>
                              ),

                              h2: ({
                                children,
                              }) => (
                                <h2 className="mb-3 mt-6 text-xl font-semibold">
                                  {children}
                                </h2>
                              ),

                              h3: ({
                                children,
                              }) => (
                                <h3 className="mb-2 mt-5 text-lg font-semibold">
                                  {children}
                                </h3>
                              ),

                              ul: ({
                                children,
                              }) => (
                                <ul className="mb-4 ml-5 list-disc space-y-1">
                                  {children}
                                </ul>
                              ),

                              ol: ({
                                children,
                              }) => (
                                <ol className="mb-4 ml-5 list-decimal space-y-1">
                                  {children}
                                </ol>
                              ),

                              li: ({
                                children,
                              }) => (
                                <li>
                                  {children}
                                </li>
                              ),

                              blockquote: ({
                                children,
                              }) => (
                                <blockquote className="my-4 border-l-4 border-border pl-4 text-muted-foreground">
                                  {children}
                                </blockquote>
                              ),

                              code: ({
                                children,
                                className,
                              }) => {
                                const isBlock =
                                  className?.includes(
                                    "language-"
                                  );

                                return isBlock ? (
                                  <code
                                    className={`${
                                      className ?? ""
                                    } block overflow-x-auto rounded-xl bg-secondary p-4 font-mono text-sm leading-6`}
                                  >
                                    {children}
                                  </code>
                                ) : (
                                  <code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.9em]">
                                    {children}
                                  </code>
                                );
                              },

                              pre: ({
                                children,
                              }) => (
                                <pre className="my-4 overflow-x-auto rounded-xl">
                                  {children}
                                </pre>
                              ),

                              a: ({
                                children,
                                href,
                              }) => (
                                <a
                                  href={href}
                                  className="underline underline-offset-2 hover:opacity-70"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {children}
                                </a>
                              ),

                              table: ({
                                children,
                              }) => (
                                <div className="my-4 overflow-x-auto rounded-lg border border-border">
                                  <table className="w-full border-collapse text-sm">
                                    {children}
                                  </table>
                                </div>
                              ),

                              th: ({
                                children,
                              }) => (
                                <th className="border-b border-border bg-secondary px-3 py-2 text-left font-semibold">
                                  {children}
                                </th>
                              ),

                              td: ({
                                children,
                              }) => (
                                <td className="border-b border-border px-3 py-2">
                                  {children}
                                </td>
                              ),

                              hr: () => (
                                <hr className="my-6 border-border" />
                              ),
                            }}
                          >
                            {msg.message}
                          </ReactMarkdown>

                          {msg.message && (
                            <div className="mt-2 text-[10px] text-muted-foreground">
                              {new Date(
                                msg.created_at
                              ).toLocaleTimeString(
                                [],
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                }
                              )}
                            </div>
                          )}

                        </div>

                      </div>

                    </div>
                  )}
                </div>
              ))}


              {toolStatus && (
                <div className="flex items-center gap-3">

                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <BotIcon className="h-4 w-4" />
                  </div>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">

                    <Loader2Icon className="h-4 w-4 animate-spin" />

                    <span>
                      {toolStatus}
                    </span>

                  </div>

                </div>
              )}

            </div>
          )}

          <div ref={divRef} />

        </div>
      </div>

      {error && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2 sm:px-6">
          <p className="text-sm text-destructive">
            {error}
          </p>
        </div>
      )}


      <div className="w-full bg-background">

        <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">

          {/* Selected file */}

          {selectedFile && (
            <div className="mb-2 flex items-center gap-2">

              <div className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-secondary px-3 py-2 text-sm">

                <PaperclipIcon className="h-4 w-4 shrink-0" />

                <span className="max-w-[240px] truncate">
                  {selectedFile.name}
                </span>

                <button
                  type="button"
                  onClick={
                    removeSelectedFile
                  }
                  disabled={isPending}
                  className="ml-1 rounded-full p-0.5 hover:bg-background disabled:opacity-50"
                  aria-label="Remove file"
                >
                  <XIcon className="h-4 w-4" />
                </button>

              </div>

            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="relative flex items-end rounded-3xl border border-border bg-background px-3 py-2 shadow-sm transition-shadow focus-within:shadow-md"
          >

            {/* Hidden file input */}

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.csv"
              onChange={handleFileChange}
              disabled={isPending}
              className="hidden"
            />

            {/* Attachment button */}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                fileInputRef.current?.click()
              }
              disabled={isPending}
              className="mb-0.5 h-9 w-9 shrink-0 rounded-full"
              aria-label="Attach file"
            >
              <PaperclipIcon className="h-4 w-4" />
            </Button>

            <Input
              placeholder={
                selectedFile
                  ? "Ask something about the file..."
                  : "Ask anything"
              }
              value={input}
              onChange={(e) =>
                setInput(e.target.value)
              }
              disabled={isPending}
              className="min-h-[44px] flex-1 border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />

            <Button
              type="submit"
              disabled={
                (!input.trim() &&
                  !selectedFile) ||
                isPending
              }
              size="icon"
              className="mb-0.5 h-9 w-9 shrink-0 rounded-full"
            >
              {isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 19V5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />

                  <path
                    d="M6 11L12 5L18 11"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </Button>

          </form>

          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            Agentic AI can make mistakes. Check important information.
          </p>

        </div>
      </div>

    </div>
  );
};

export default Chat;
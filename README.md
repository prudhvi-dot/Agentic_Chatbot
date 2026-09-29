# DeepScout

An agentic chat assistant that decides for itself when to search the web, look inside your uploaded documents, or pull a live stock price — and can chain several of those together before answering.

**[Live demo](https://agentic-chatbot-swart.vercel.app/)**

---

## What this project is for

DocuSense, my other project, is built around a fixed pipeline: retrieve, grade, generate, verify, with every branch decided in advance. DeepScout is the deliberate opposite. There's no pipeline here — one agent, bound to a set of tools, decides at runtime whether it needs to search, which tool to use, how many times to call it, and when it has enough to answer. The two projects together are meant to show both sides of RAG/agent engineering: a system where the flow is fixed and verifiable, and one where the model controls its own flow.

## Features

- Chat that streams as it's generated, with live status ("Searching the web...", tool name shown as it runs) instead of a silent wait
- Web search for current information
- Document-aware answers — attach a PDF to a chat and ask about it, no separate upload flow needed
- A ChatGPT-style shell: sidebar of past chats, click one to resume, "New chat" starts fresh
- Full auth, per-user chat isolation, conversation memory across sessions

## Architecture

### One agent, three tools

```
User message
     ↓
  chat_node (LLM bound to tools)
     ↓
  tool call? ──no──→ answer
     │yes
     ↓
  ToolNode
     ↓
  search_tool | retrieve_context
     ↓
  back to chat_node, repeat until no tool call remains
```

This is LangGraph's standard `tools_condition` / `ToolNode` loop. The interesting part isn't the wiring, it's what the wiring enables: the model can call `search_tool` twice with different queries if the first result wasn't enough, or call `retrieve_context` and then `search_tool` in the same turn if the answer needs both the document and current information — sequences I never hardcoded, because there's nothing to hardcode. The system prompt tells the model what each tool is for; everything else is the model's own decision at inference time.

### The three tools

| Tool | Purpose | Notes |
|---|---|---|
| `search_tool` | Web search (Tavily) for current events or anything outside the model's training data | Standard, stateless — runs through a plain `ToolNode` |
| `retrieve_context` | Searches documents uploaded in the current chat | Scoped to the chat's own Pinecone namespace (`namespace=chat_id`), so retrieval never crosses into another chat's or another user's documents |

### Why a single agent instead of the fixed graph I used in DocuSense

DocuSense's fixed graph gives bounded, enumerable behavior, which matters when every answer has to be verifiably grounded in one document. That constraint doesn't apply here — there's no single source of truth to stay inside, so the value of a fixed pipeline is lower and the value of letting the model plan its own approach is higher. Different problem, different architecture, on purpose.

### Streaming and tool visibility

The backend streams two kinds of events over NDJSON: generated tokens, and a status event the moment the model decides to call a tool. The status is ephemeral — shown live while a tool is running, cleared the instant real answer text starts streaming, and never persisted. Only the finished human/AI message pair is saved to the database. Persisting the trace was considered and deliberately skipped, since it adds a second display concern for something that's genuinely one-time, in-the-moment context.

### Memory

Two separate memory mechanisms serve two different purposes, matching the same design used in DocuSense:
- **LangGraph's Postgres checkpointer** (keyed by `chat_id` as the thread ID) gives the agent its own short-term continuity within and across turns — this is what lets it hold context across multiple tool calls in one reasoning chain.
- **The app's own `Message` table** is the source of truth for what the user sees — fetched to render chat history, independent of the checkpointer's internal format.

## Security & isolation

- JWT in an `httpOnly` cookie, reused directly from DocuSense's auth implementation.
- Every chat route checks `chat.user_id == current_user.id` before running anything — a request for another user's chat returns 403.
- Documents uploaded in a chat live in that chat's own Pinecone namespace. Retrieval can't reach another chat's data because the search space never contains it.
- Deleting a chat cleans up all three places its data lives: the `Chat`/`Message` rows (cascade), the Pinecone namespace, and the LangGraph checkpoint thread. Deleting only the database rows and leaving the vector/checkpoint data behind was an early gap, since fixed once it was caught.

## Request lifecycle — sending a message

1. Message (and optional file) submitted as `multipart/form-data` from a Client Component.
2. `POST /api/chats/{chat_id}/send` — if the chat doesn't exist yet, it's created on this first call rather than when the user clicks "New chat," so no empty chats are ever created if a user backs out before typing anything.
3. Ownership is verified.
4. If a file was attached, it's ingested into the chat's Pinecone namespace before the agent runs, so it's immediately searchable in the same turn.
5. The agent loop runs, streaming tokens and tool-status events back as NDJSON.
6. Once the loop ends, the human/AI message pair is saved, and on the first message in a chat, a title is generated from the exchange.
7. The frontend refreshes the sidebar once, after the first message in a new chat, so the chat appears with its real title without a manual reload.

## Project structure

```
Backend/
  app/
    auth/            reused from DocuSense
    config/           settings, database, vectorstore config
    models/            User, Chat, Message
    RAG/              agent graph, tools, retrieval
    routers/         users, chats

frontend/
  app/
    [id]/              individual chat route
    layout.tsx          sidebar, persists across chat navigation
    page.tsx             empty state / landing
  components/       Chat, SessionSidebar, shadcn/ui primitives
```

## Known limitations

- Multiple documents uploaded into the same chat share one namespace, so `retrieve_context` searches across all of them rather than targeting a specific file. Asking about "the pdf" when more than one has been uploaded can retrieve from the wrong one. Fixing this properly (per-document IDs, a document list in the system prompt) was scoped out to keep this project's timeline realistic alongside a second, more architecturally involved project.
- No inline citations showing which tool or source backed a given claim.

## Tech stack

**Backend:** FastAPI · SQLAlchemy 2.0 · PostgreSQL (NeonDB)
**AI/Agent:** LangGraph (`tools_condition` / `ToolNode`) · LangChain · OpenAI · Tavily · Pinecone · LangGraph Postgres checkpointer
**Frontend:** Next.js (App Router) · React Server Components · Tailwind · shadcn/ui
**Auth:** JWT, httpOnly cookies

## Setup

```bash
# Backend
cd Backend
uv sync
uv run alembic upgrade head
uv run fastapi dev main.py

# Frontend
cd frontend
npm install
npm run dev
```

### Environment variables (Backend `.env`)

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Powers the agent's reasoning and tool selection |
| `TAVILY_API_KEY` | Web search tool |
| `PINECONE_API_KEY` | Vector store for document retrieval |
| `DATABASE_URL` | PostgreSQL connection (NeonDB) — used by SQLAlchemy and the LangGraph checkpointer |
| `SECRET_KEY` | Signs and verifies JWT access tokens |

import json
from typing import Annotated

from app.agent.agent import chatbot, checkpointer
from app.auth import CurrentUser
from app.config.config import settings
from app.config.database import get_db
from app.models import models
from app.Rag.config import get_pinecone_index
from app.Rag.ingestion import ingest
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage
from langchain_openai import ChatOpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

router = APIRouter()

title_model = ChatOpenAI(
    model="gpt-4o-mini", openai_api_key=settings.OPENAI_API_KEY
)  # example — use your actual client


def generate_title_from_llm(user_message: str, ai_response: str) -> str:
    """Ask a small model for a short, descriptive chat title."""
    prompt = (
        "Generate a concise 3-6 word title summarizing this conversation. "
        "Return ONLY the title text — no quotes, no punctuation at the end, "
        "no preamble.\n\n"
        f"User: {user_message}\n"
        f"Assistant: {ai_response[:300]}"
    )
    try:
        response = title_model.invoke([HumanMessage(content=prompt)])
        title = response.content.strip().strip('"').strip()
        return title[:60] if title else "New Chat"
    except Exception as e:
        print("Title generation error:", e)
        return generate_title(user_message)


def generate_title(message: str, max_length: int = 50) -> str:
    """Fallback: truncate the raw message if the LLM call fails."""
    title = message.strip().replace("\n", " ")
    if len(title) > max_length:
        title = title[:max_length].rsplit(" ", 1)[0] + "..."
    return title or "New Chat"


@router.post("", status_code=status.HTTP_201_CREATED)
def create_chat(current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    new_chat = models.Chat(user_id=current_user.id, title="New Chat")
    db.add(new_chat)
    db.commit()
    db.refresh(new_chat)
    return {"chat_id": new_chat.id}


@router.get("", status_code=status.HTTP_200_OK)
def get_all_chats(current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]):
    return current_user.chats


@router.get("/{chat_id}/messages", status_code=status.HTTP_200_OK)
def get_chat_messages(
    chat_id: str, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]
):

    result = db.execute(select(models.Message).where(models.Message.chat_id == chat_id))
    messages = result.scalars().all()
    if not messages:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found"
        )
    return {"messages": messages}


@router.delete("/{chat_id}", status_code=status.HTTP_200_OK)
def delete_chat(
    chat_id: str, current_user: CurrentUser, db: Annotated[Session, Depends(get_db)]
):
    result = db.execute(select(models.Chat).where(models.Chat.id == chat_id))
    chat = result.scalars().first()

    if not chat:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found"
        )

    if chat.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to access this chat",
        )

    # External cleanup first, so a failure leaves the chat in place and retryable
    try:
        get_pinecone_index().delete(delete_all=True, namespace=chat_id)
    except Exception as e:
        # A chat with no uploads has no namespace, which some Pinecone
        # versions report as an error. Log it and carry on.
        print("Pinecone cleanup skipped:", e)

    checkpointer.delete_thread(chat_id)

    db.delete(chat)
    db.commit()
    return {"message": "Chat deleted successfully"}


@router.post("/{chat_id}/send")
def send_message(
    chat_id: str,
    current_user: CurrentUser,
    db: Annotated[Session, Depends(get_db)],
    message: Annotated[str | None, Form()] = None,
    file: Annotated[UploadFile | None, File()] = None,
):
    message = (message or "").strip()

    if not message and not file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Send a message, a file, or both.",
        )

    result = db.execute(select(models.Chat).where(models.Chat.id == chat_id))
    chat = result.scalars().first()

    if not chat:
        chat = models.Chat(id=chat_id, user_id=current_user.id, title="New Chat")
        db.add(chat)
        db.commit()
        db.refresh(chat)

    if chat.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to access this chat",
        )

    filename = None
    if file:
        if file.content_type != "application/pdf":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only PDF files are supported.",
            )
        filename = file.filename or "document.pdf"
        try:
            ingest(file.file.read(), chat_id)
        except Exception as e:
            print("Ingestion error:", e)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not process that file.",
            )

    # File-only path: no question to answer, so skip the graph entirely
    if not message:
        confirmation = (
            f"I've processed **{filename}**. What would you like to know about it?"
        )

        def file_only_generator():
            try:
                db.add_all(
                    [
                        models.Message(
                            chat_id=chat_id,
                            role="human",
                            message=f"📎 Uploaded {filename}",
                        ),
                        models.Message(
                            chat_id=chat_id, role="ai", message=confirmation
                        ),
                    ]
                )
                if chat.title == "New Chat":
                    chat.title = filename
                db.commit()
            except Exception:
                db.rollback()
                yield (
                    json.dumps({"type": "error", "message": "Failed to save upload."})
                    + "\n"
                )
                return

            yield json.dumps({"type": "final", "content": confirmation}) + "\n"

        return StreamingResponse(
            file_only_generator(),
            media_type="application/x-ndjson",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    def generate():
        full_response = ""
        tool_status_sent = False

        try:
            for stream_mode, payload in chatbot.stream(
                {"messages": [HumanMessage(content=message)]},
                config={"configurable": {"thread_id": chat_id}},
                stream_mode=["messages", "updates"],
            ):
                if stream_mode == "updates":
                    for node_name, node_output in payload.items():
                        if node_name == "tools" and not tool_status_sent:
                            tool_status_sent = True

                            yield (
                                json.dumps(
                                    {
                                        "type": "status",
                                        "status": "searching",
                                        "message": "Searching the web...",
                                    }
                                )
                                + "\n"
                            )

                    continue

                message_chunk, metadata = payload

                if not isinstance(
                    message_chunk,
                    AIMessageChunk,
                ):
                    continue

                if message_chunk.tool_call_chunks:
                    continue

                if not message_chunk.content:
                    continue

                if not isinstance(
                    message_chunk.content,
                    str,
                ):
                    continue

                content = message_chunk.content

                full_response += content

                yield (
                    json.dumps(
                        {
                            "type": "token",
                            "content": content,
                        }
                    )
                    + "\n"
                )

            human_message = models.Message(
                chat_id=chat_id,
                role="human",
                message=message,
            )

            ai_message = models.Message(
                chat_id=chat_id,
                role="ai",
                message=full_response,
            )

            db.add_all(
                [
                    human_message,
                    ai_message,
                ]
            )

            if chat.title == "New Chat":
                chat.title = generate_title_from_llm(message, full_response)
                db.add(chat)

            db.commit()

            yield (
                json.dumps(
                    {
                        "type": "final",
                        "content": full_response,
                    }
                )
                + "\n"
            )

        except Exception as e:
            print("Streaming error:", e)

            db.rollback()

            yield (
                json.dumps(
                    {
                        "type": "error",
                        "message": "Failed to generate a response.",
                    }
                )
                + "\n"
            )

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )

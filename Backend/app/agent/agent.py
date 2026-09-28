from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_tavily import TavilySearch
from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.graph import START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from psycopg_pool import ConnectionPool

from app.config.config import settings
from app.Rag.retrieve import retrieve_context

load_dotenv()

llm = ChatOpenAI(model="gpt-4o-mini", api_key=settings.OPENAI_API_KEY)


class ChatState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


search_tool = TavilySearch(
    max_results=5,
    topic="general",
    search_depth="advanced",
    api_key=settings.TAVILY_API_KEY,
)


tools = [search_tool, retrieve_context]

llm_with_tools = llm.bind_tools(tools)


def chat_node(state: ChatState):

    system_message = SystemMessage(
        content=(
            "You are a helpful Agentic Chatbot with access to several tools.\n\n"
            "Tool usage instructions:\n"
            "- Use `retrieve_context` whenever the user's question is about "
            "an uploaded PDF, document, or requires information from uploaded "
            "context. This includes summarization, explanation, analysis, "
            "questions about the document, key points, moral, themes, etc.\n"
            "- Use `search_tool` for current events, recent information, "
            "or information that requires an internet search.\n"
            "- Answer general questions directly when no tool is required.\n\n"
            "Response formatting instructions:\n"
            "- Format your final responses using Markdown.\n"
            "- Use headings when they improve readability.\n"
            "- Use bullet points or numbered lists when appropriate.\n"
            "- Use **bold** for important terms or key information.\n"
            "- Use `inline code` for code, commands, variables, and technical terms.\n"
            "- Use fenced code blocks with the appropriate language for programming code.\n"
            "- Use Markdown tables when presenting structured information or comparisons.\n"
            "- Do not output raw HTML.\n"
            "- Do not wrap the entire response in a code block.\n"
            "- Keep simple responses concise and natural; do not add unnecessary headings.\n\n"
            "Do not invent information from tool results. "
            "After receiving a tool result, provide a clear and helpful answer."
        )
    )

    messages = [system_message, *state["messages"]]
    response = llm_with_tools.invoke(messages)

    return {"messages": [response]}


tool_node = ToolNode(tools)


DB_URI = settings.DATABASE_URL


def get_chatbot():

    pool = ConnectionPool(
        conninfo=DB_URI,
        min_size=1,
        max_size=5,
        kwargs={
            "autocommit": True,
        },
        check=ConnectionPool.check_connection,
    )

    checkpointer = PostgresSaver(pool)
    checkpointer.setup()

    graph = StateGraph(ChatState)

    graph.add_node("chat_node", chat_node)
    graph.add_node("tools", tool_node)

    graph.add_edge(START, "chat_node")
    graph.add_conditional_edges("chat_node", tools_condition)
    graph.add_edge("tools", "chat_node")

    return graph.compile(checkpointer=checkpointer), checkpointer


chatbot, checkpointer = get_chatbot()

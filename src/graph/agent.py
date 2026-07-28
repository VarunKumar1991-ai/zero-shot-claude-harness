"""Graph assembly for the UP Police Data Analyst Agent.

See spec/agent.md -> "Graph Assembly" (binding pseudocode, reproduced here as
a real, compilable LangGraph `StateGraph`).
"""
from langgraph.graph import StateGraph, END

from graph.state import AgentState
from graph.nodes import (
    load_context, classify_and_assess, plan_analysis, generate_code,
    execute_code, inspect_result, synthesize_answer, suggest_followups,
    request_clarification, handle_error, finalize,
)
from graph.edges import (
    after_load_context, after_classify, after_inspect_result,
)


def _build_graph() -> StateGraph:
    g = StateGraph(AgentState)
    for name, fn in [
        ("load_context", load_context),
        ("classify_and_assess", classify_and_assess),
        ("plan_analysis", plan_analysis),
        ("generate_code", generate_code),
        ("execute_code", execute_code),
        ("inspect_result", inspect_result),
        ("synthesize_answer", synthesize_answer),
        ("suggest_followups", suggest_followups),
        ("request_clarification", request_clarification),
        ("handle_error", handle_error),
        ("finalize", finalize),
    ]:
        g.add_node(name, fn)

    g.set_entry_point("load_context")

    g.add_conditional_edges("load_context", after_load_context, {
        "classify_and_assess": "classify_and_assess", "handle_error": "handle_error",
    })
    g.add_conditional_edges("classify_and_assess", after_classify, {
        "plan_analysis": "plan_analysis",
        "generate_code": "generate_code",
        "request_clarification": "request_clarification",
        "handle_error": "handle_error",
    })
    g.add_edge("plan_analysis", "generate_code")
    g.add_edge("generate_code", "execute_code")
    g.add_edge("execute_code", "inspect_result")
    g.add_conditional_edges("inspect_result", after_inspect_result, {
        "generate_code": "generate_code", "synthesize_answer": "synthesize_answer",
    })
    g.add_edge("synthesize_answer", "suggest_followups")
    g.add_edge("suggest_followups", "finalize")
    g.add_edge("request_clarification", "finalize")
    g.add_edge("handle_error", "finalize")
    g.add_edge("finalize", END)

    return g.compile()


agentic_ai = _build_graph()

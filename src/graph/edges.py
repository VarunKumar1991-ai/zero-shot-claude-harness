"""Conditional routing table for the query agent graph.

See spec/agent.md -> "Graph / Flow Topology" (binding). Only `load_context`
and `classify_and_assess` route to `handle_error`; every downstream node
degrades gracefully instead (see graph/nodes.py docstrings) because the
topology has no fatal branch past classification.
"""
from graph.state import AgentState


def after_load_context(state: AgentState) -> str:
    if state.get("error"):
        return "handle_error"
    return "classify_and_assess"


def after_classify(state: AgentState) -> str:
    if state.get("error"):
        return "handle_error"
    if state.get("needs_clarification"):
        return "request_clarification"
    if state.get("complexity") == "complex":
        return "plan_analysis"
    return "generate_code"


def after_inspect_result(state: AgentState) -> str:
    if state.get("_needs_retry"):
        return "generate_code"
    return "synthesize_answer"

def apply_change(state, fail=False):
    if fail:
        raise ValueError("transaction failed")
    state["balance"] += 1
    return state["balance"]

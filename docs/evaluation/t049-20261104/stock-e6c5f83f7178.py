def reserve(stock, quantity, persist):
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    if stock["remaining"] < quantity:
        return False
    original_remaining = stock["remaining"]
    stock["remaining"] -= quantity
    try:
        persist(dict(stock))
    except Exception:
        stock["remaining"] = original_remaining
        raise
    return True

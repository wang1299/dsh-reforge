def reserve(stock, quantity, persist):
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    if stock["remaining"] < quantity:
        return False
    previous = stock["remaining"]
    stock["remaining"] = previous - quantity
    try:
        persist(dict(stock))
    except Exception:
        stock["remaining"] = previous
        raise
    return True

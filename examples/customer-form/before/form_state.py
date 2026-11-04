def submit(draft, persist):
    if not draft.get("name", "").strip():
        return {"ok": False, "draft": dict(draft), "message": "请填写客户姓名"}
    outgoing = dict(draft)
    draft.clear()
    try:
        persist(outgoing)
    except OSError:
        return {"ok": False, "draft": dict(draft), "message": "保存失败：服务暂不可用，请稍后重试"}
    return {"ok": True, "draft": dict(draft), "message": "客户已保存"}

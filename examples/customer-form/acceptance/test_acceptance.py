from form_state import submit


def test_failed_save_preserves_every_input():
    draft = {"name": "林小满（演示）", "phone": "000-0000-0000", "note": "周五回访，先发方案"}
    original = dict(draft)

    def unavailable(data):
        raise OSError("synthetic service failure")

    result = submit(draft, unavailable)
    assert result["ok"] is False
    assert draft == original
    assert result["draft"] == original
    assert "失败" in result["message"]


def test_success_returns_empty_draft_only_after_service_finishes():
    draft = {"name": "林小满（演示）", "phone": "000-0000-0000", "note": "周五回访，先发方案"}
    seen = []

    def saved(data):
        assert draft["note"] == "周五回访，先发方案"
        seen.append(dict(data))

    result = submit(draft, saved)
    assert result["ok"] is True and len(seen) == 1
    assert draft == {} and result["draft"] == {}

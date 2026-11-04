from form_state import submit


def test_success_clears_after_persist():
    draft = {"name": "演示客户", "phone": "测试号码", "note": "演示备注"}
    captured = []
    result = submit(draft, lambda data: captured.append(dict(data)))
    assert result["ok"] is True
    assert captured[0]["name"] == "演示客户"
    assert draft == {} and result["draft"] == {}


def test_validation_keeps_input():
    draft = {"name": "", "phone": "测试号码", "note": "尚未填完"}
    original = dict(draft)
    result = submit(draft, lambda data: None)
    assert result["ok"] is False
    assert draft == original


def test_one_submission_calls_persistence_once():
    calls = []
    result = submit({"name": "演示客户"}, lambda data: calls.append(data))
    assert result["ok"] is True and len(calls) == 1

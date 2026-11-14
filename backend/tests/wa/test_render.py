import pytest

from vali_wa.render import (cites_for, fill_placeholders, number_sources, render_ack,
    render_execution_update, render_result, split_messages)


def test_exact_result_snapshot(task):
    assert render_result(task) == [
        "*You may qualify for €400 in flight-delay compensation.* [1]\n\n"
        "• Delay: 4 hours [2]\n"
        "• Compensation: €400 [1]\n"
        "• Eligibility: Subject to the cause of delay (check) [3]\n\n"
        "Reply 1 to file the claim [3]\n"
        "Reply 2 to review the email draft\n\n"
        "*Missing information*\n"
        "• What is your booking reference, ‹name›?\n\n"
        "*Sources*\n"
        "[1] EU passenger rights – https://europa.eu/rights\n"
        "[2] Delay record – https://airline.example/delay\n"
        "[3] Airline conditions – https://airline.example/conditions"
    ]
    assert "Test Person" in render_result(task, {"name": "Test Person"})[0]


def test_numbering_matches_extension():
    numbered = number_sources([
        {"field": "$.steps.0.detail", "citations": [
            {"url": "https://EXAMPLE.COM:443", "title": "First"},
            {"url": "https://example.com/"}, {"url": "javascript:bad"}], "confidence": "medium"},
        {"field": "steps[0].title", "citations": [{"url": "https://other.example/path"}], "confidence": "low"},
        {"field": "answer", "citations": [{"url": "https://example.com/"}], "confidence": "high"},
        {"field": "answer", "citations": [{"url": "https://other.example/path"}]},
    ])
    assert numbered["sources"] == [
        {"n": 1, "url": "https://example.com/", "title": "First", "host": "example.com"},
        {"n": 2, "url": "https://other.example/path", "title": "other.example", "host": "other.example"}]
    assert cites_for(numbered["byField"], "steps[0]") == {"nums": [1, 2], "confidence": "low"}
    assert cites_for(numbered["byField"], "answer") == {"nums": [2], "confidence": None}


@pytest.mark.parametrize("text", ["a" * 10000, ("long line\n" * 2000), "😀" * 5000])
def test_splitting(text, task):
    parts = split_messages(text)
    assert "".join(parts) == text
    assert all(0 < len(p) <= 4096 for p in parts)
    task["research"]["output"]["structured"]["answer"] = text
    assert all(len(p) <= 4096 for p in render_result(task))


def test_limits_and_placeholders(task):
    structured = task["research"]["output"]["structured"]
    structured["key_facts"] *= 3
    task["research"]["output"]["grounding"] += [
        {"field": "answer", "citations": [{"url": f"https://source.example/{n}"} for n in range(10)]}]
    rendered = "\n".join(render_result(task))
    assert rendered.count("• Delay:") == 2
    assert "[8]" in rendered and "[9]" not in rendered
    assert fill_placeholders("{{NAME}} {{unknown}}", {"name": "Test Person"}) == "Test Person ‹unknown›"
    assert fill_placeholders("{{name}}", {"name": " "}) == "‹name›"
    assert render_ack(task) == ["Vali is on it — claim and apply."]


def test_execution(task):
    task["execution"] = {"status": "awaiting_approval", "approval": {
        "summary": "Claim for {{name}}", "filled": [{"label": "Full name", "value": "{{name}}"}]}}
    assert render_execution_update(task, {"name": "Test Person"}) == [
        "Ready to submit: Claim for Test Person.\nFilled: Full name: Test Person\nReply *yes* to submit or *stop*."]
    task["execution"] = {"status": "running", "steps": [{"text": "Opened claim form"}]}
    assert render_execution_update(task) == ["Working on it: Opened claim form"]
    task["execution"] = {"status": "done", "result": "Claim submitted"}
    assert render_execution_update(task) == ["Claim submitted"]
    task["execution"] = {"status": "failed", "error": "Login required", "final_url": "https://airline.example/claim"}
    assert render_execution_update(task) == ["Vali could not finish: Login required\nfinish here: https://airline.example/claim"]
    task["execution"] = {"status": "stopped"}
    assert render_execution_update(task) == ["Stopped. Vali will not submit this errand."]

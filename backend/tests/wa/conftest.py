import pytest


@pytest.fixture
def task():
    return {
        "id": "t_claim", "user_id": "u_test", "mode": "claim", "source": "whatsapp",
        "task": "My flight landed four hours late",
        "research": {"status": "completed", "output": {"structured": {
            "answer": "You may qualify for €400 in flight-delay compensation.",
            "status": "needs_info",
            "key_facts": [{"label": "Delay", "value": "4 hours"},
                          {"label": "Compensation", "value": "€400"},
                          {"label": "Eligibility", "value": "Subject to the cause of delay"}],
            "steps": [{"title": "Claim", "detail": "Use the airline claim form"}],
            "actions": [{"type": "open_link", "label": "file the claim", "url": "https://airline.example/claim"},
                        {"type": "email", "label": "review the email draft", "body": "Dear team, I am {{name}}."}],
            "missing_info": ["What is your booking reference, {{name}}?"],
            "form_fill": [{"field_id": "name", "value": "{{name}}"}],
        }, "grounding": [
            {"field": "answer", "citations": [{"url": "https://europa.eu/rights", "title": "EU passenger rights"}], "confidence": "high"},
            {"field": "key_facts[0].value", "citations": [{"url": "https://airline.example/delay", "title": "Delay record"}], "confidence": "high"},
            {"field": "$.key_facts.1.value", "citations": [{"url": "https://europa.eu/rights", "title": "Duplicate title"}], "confidence": "high"},
            {"field": "key_facts[2]", "citations": [{"url": "https://airline.example/conditions", "title": "Airline conditions"}], "confidence": "low"},
            {"field": "actions[0].url", "citations": [{"url": "https://airline.example/conditions"}], "confidence": "high"},
        ]}}, "execution": None,
    }


@pytest.fixture
def webhook_payload():
    return {"object": "whatsapp_business_account", "entry": [{"id": "account_test", "changes": [{
        "field": "messages", "value": {"messaging_product": "whatsapp",
        "metadata": {"display_phone_number": "+358401234567", "phone_number_id": "phone_test"},
        "contacts": [{"profile": {"name": "Test Person"}, "wa_id": "+358401234567"}],
        "messages": [
            {"from": "+358401234567", "id": "m_text", "timestamp": "1794614400", "type": "text", "text": {"body": "Help with my flight"}},
            {"from": "+358401234567", "id": "m_audio", "timestamp": "1794614401", "type": "audio", "audio": {"id": "audio_test", "mime_type": "audio/ogg; codecs=opus", "voice": True}},
            {"from": "+358401234567", "id": "m_image", "timestamp": "1794614402", "type": "image", "image": {"id": "image_test", "mime_type": "image/jpeg", "caption": "Explain this letter"}},
            {"from": "+358401234567", "id": "m_button", "timestamp": "1794614403", "type": "interactive", "interactive": {"type": "button_reply", "button_reply": {"id": "yes", "title": "Approve"}}},
        ], "statuses": [{"id": "m_out", "status": "delivered", "timestamp": "1794614404", "recipient_id": "+358401234567"}]}
    }]}]}

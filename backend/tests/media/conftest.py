import pytest


@pytest.fixture(autouse=True)
def offline_environment(monkeypatch):
    for key in ("CLOUDINARY_URL", "ELEVENLABS_API_KEY", "ANTHROPIC_API_KEY", "VALI_MODEL", "HOIDA_MODEL"):
        monkeypatch.delenv(key, raising=False)

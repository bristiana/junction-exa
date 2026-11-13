import json
import threading
import time
from types import SimpleNamespace

import cloudinary.uploader
import pytest

from hoida_media import screenshots


def test_missing_config_never_uploads(monkeypatch):
    def unexpected(*args, **kwargs):
        pytest.fail("upload attempted without configuration")
    monkeypatch.setattr(cloudinary.uploader._http, "request", unexpected)
    assert screenshots.upload_screenshot(b"jpeg", "task-test", 1) is None


def test_upload_through_sdk(monkeypatch):
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://test-key:test-secret@test-cloud")
    url = "https://res.cloudinary.com/test-cloud/image/upload/v1/hoida/task-test/step-007.jpg"
    calls = []

    def request(**kwargs):
        calls.append(kwargs)
        fields = dict(kwargs["fields"])
        assert fields["folder"] == "hoida/task-test"
        assert fields["public_id"] == "step-007"
        assert fields["tags"] == "hoida,task-test"
        assert fields["overwrite"] == "1"  # SDK serialization of overwrite=True
        assert fields["file"][1] == b"synthetic-jpeg"
        assert "/image/upload" in kwargs["url"]
        assert kwargs["timeout"] <= 10
        return SimpleNamespace(headers={}, status=200, data=json.dumps({"secure_url": url}).encode())

    monkeypatch.setattr(cloudinary.uploader._http, "request", request)
    assert screenshots.upload_screenshot(b"synthetic-jpeg", "task-test", 7) == url
    assert len(calls) == 1


def test_failure_logs_one_safe_line(monkeypatch, caplog):
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://test-key:test-secret@test-cloud")

    def broken(**kwargs):
        raise RuntimeError("sensitive-provider-message")

    monkeypatch.setattr(cloudinary.uploader._http, "request", broken)
    assert screenshots.upload_screenshot(b"jpeg", "task-test", 1) is None
    assert len(caplog.records) == 1
    assert "sensitive-provider-message" not in caplog.text
    assert "test-secret" not in caplog.text


def test_hard_deadline_even_if_sdk_blocks(monkeypatch, caplog):
    monkeypatch.setenv("CLOUDINARY_URL", "cloudinary://test-key:test-secret@test-cloud")
    monkeypatch.setattr(screenshots, "UPLOAD_TIMEOUT", 0.03)
    release = threading.Event()
    done = threading.Event()

    def stalled(*args, **kwargs):
        try:
            release.wait(1)
            return {"secure_url": "https://example.invalid/shot.jpg"}
        finally:
            done.set()

    monkeypatch.setattr(cloudinary.uploader, "upload", stalled)
    started = time.monotonic()
    try:
        assert screenshots.upload_screenshot(b"jpeg", "task-test", 1) is None
        assert time.monotonic() - started < 0.5
        assert len(caplog.records) == 1
    finally:
        release.set()
        assert done.wait(1)


def test_thumbnail_preserves_version_path_and_query():
    url = "https://res.cloudinary.com/demo/image/upload/v3/hoida/t/step-001.jpg?x=y"
    assert screenshots.thumbnail_url(url, 480) == url.replace(
        "/upload/", "/upload/c_limit,w_480,q_auto,f_auto/",
    )
    assert screenshots.thumbnail_url("/v1/tasks/t/shots/1.jpg?t=test", 480) == "/v1/tasks/t/shots/1.jpg?t=test"
    assert screenshots.thumbnail_url(None, 480) is None


@pytest.mark.parametrize("width", [0, -1, True, 2.5])
def test_invalid_thumbnail_width(width):
    with pytest.raises(ValueError):
        screenshots.thumbnail_url("https://example.invalid/a.jpg", width)

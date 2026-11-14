"""Optional screenshot hosting with a bounded wait and API-store fallback."""

import io
import logging
import os
import queue
import threading
import time
from urllib.parse import urlsplit, urlunsplit

import cloudinary
import cloudinary.uploader

logger = logging.getLogger(__name__)
UPLOAD_TIMEOUT = 10.0
# Bound abandoned workers when an SDK/network operation ignores its timeout.
_slots = threading.BoundedSemaphore(4)


def upload_screenshot(jpeg_bytes: bytes, task_id: str, n: int) -> str | None:
    """Return a secure URL, or None so the caller can serve its stored bytes.

    The daemon worker may finish after the caller's deadline. Overwrite and the
    deterministic public ID make a subsequent retry idempotent.
    """
    deadline = time.monotonic() + UPLOAD_TIMEOUT
    if not os.environ.get("CLOUDINARY_URL"):
        return None
    if not _slots.acquire(blocking=False):
        logger.warning("Vali screenshot upload unavailable (busy)")
        return None
    results: queue.Queue[str | None] = queue.Queue(maxsize=1)

    def upload() -> None:
        try:
            cloudinary.config()
            # Config reads CLOUDINARY_URL afresh, including when configured
            # after module import; pass credentials per request, not globally.
            config = cloudinary.Config()
            result = cloudinary.uploader.upload(
                io.BytesIO(jpeg_bytes), folder=f"vali/{task_id}",
                public_id=f"step-{n:03d}", overwrite=True,
                resource_type="image", tags=["vali", task_id],
                timeout=UPLOAD_TIMEOUT,
                cloud_name=config.cloud_name, api_key=config.api_key,
                api_secret=config.api_secret,
            )
            url = result.get("secure_url")
            results.put(url if isinstance(url, str) and url.startswith("https://") else None)
        except Exception:
            # Never log exception text: SDK errors can contain credentials/URLs.
            results.put(None)
        finally:
            _slots.release()

    try:
        threading.Thread(target=upload, daemon=True, name="vali-upload").start()
    except Exception:
        _slots.release()
        logger.warning("Vali screenshot upload failed")
        return None
    try:
        url = results.get(timeout=max(0.0, deadline - time.monotonic()))
    except queue.Empty:
        logger.warning("Vali screenshot upload timed out")
        return None
    if url is None:
        logger.warning("Vali screenshot upload failed")
    return url


def thumbnail_url(url: str | None, width: int) -> str | None:
    """Add a Cloudinary delivery transformation; preserve fallback/API URLs."""
    if isinstance(width, bool) or not isinstance(width, int) or width <= 0:
        raise ValueError("width must be a positive integer")
    if not url:
        return url
    parts = urlsplit(url)
    if parts.hostname != "res.cloudinary.com" or "/image/upload/" not in parts.path:
        return url
    path = parts.path.replace(
        "/image/upload/", f"/image/upload/c_limit,w_{width},q_auto,f_auto/", 1,
    )
    return urlunsplit(parts._replace(path=path))

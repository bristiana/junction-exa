"""Bounded uploads and safe document normalization; never persist originals."""
from io import BytesIO

from fastapi import HTTPException

MAX_UPLOAD = 10 * 1024 * 1024
# Whole multipart request (file plus form fields and boundaries): Content-Length, then the streamed bytes.
MAX_REQUEST = 11 * 1024 * 1024
UPLOAD_PATHS = {'/v1/voice', '/v1/letters'}
AUDIO_TYPES = {'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav',
               'audio/x-caf', 'audio/caf'}
# Browsers and the Mac app may send a generic type; the extension then names the container.
AUDIO_BY_EXTENSION = {'webm': 'audio/webm', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4', 'mp4': 'audio/mp4',
                      'caf': 'audio/x-caf', 'wav': 'audio/wav'}
GENERIC_TYPES = {'', 'application/octet-stream'}
LETTER_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'}
MAX_PIXELS = 40_000_000
VISION_MAX_BYTES = 5 * 1024 * 1024  # Claude's per-image limit
VISION_MAX_SIDE = 4096
JPEG_QUALITY = 85


async def too_large(scope, receive, send):
    from fastapi.responses import JSONResponse
    await JSONResponse({'detail': 'Upload exceeds 10 MB'}, status_code=413)(scope, receive, send)


class UploadLimit:
    """ASGI guard that counts the streamed body of an upload, so a chunked request without Content-Length cannot
    exceed the limit either; the body is replayed to the app once it fits."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['path'] not in UPLOAD_PATHS:
            return await self.app(scope, receive, send)
        declared = dict(scope.get('headers') or []).get(b'content-length', b'')
        if declared.isdigit() and int(declared) > MAX_REQUEST:  # refused before reading a byte
            return await too_large(scope, receive, send)
        body, more = b'', True
        while more:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body += message.get('body', b'')
            more = message.get('more_body', False)
            if len(body) > MAX_REQUEST:
                return await too_large(scope, receive, send)
        replayed = False

        async def replay():
            nonlocal replayed
            if replayed:
                return await receive()
            replayed = True
            return {'type': 'http.request', 'body': body, 'more_body': False}
        await self.app(scope, replay, send)


def upload_mime(upload):
    return (upload.content_type or '').split(';')[0].strip().lower()


def audio_mime(upload):
    """The declared audio type, or one inferred from a .webm/.m4a/.caf/... filename."""
    mime = upload_mime(upload)
    if mime in GENERIC_TYPES:
        extension = (upload.filename or '').rpartition('.')[2].lower()
        return AUDIO_BY_EXTENSION.get(extension, mime)
    return mime


def read_upload(upload, allowed, mime=None):
    data = upload.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, 'Upload exceeds 10 MB')
    if not data:
        raise HTTPException(400, 'Empty upload')
    mime = mime if mime is not None else upload_mime(upload)
    if mime not in allowed:
        raise HTTPException(415, 'Unsupported upload type')
    return data, mime


def pdf_text(data):
    from pypdf import PdfReader
    try:
        reader = PdfReader(BytesIO(data))
        parts, length = [], 0
        if len(reader.pages) > 100:
            raise ValueError
        for page in reader.pages:
            text = page.extract_text() or ''
            length += len(text)
            if length > 100000:
                raise ValueError
            parts.append(text)
        text = '\n'.join(parts).strip()
        if not text:
            raise ValueError
        return text
    except Exception:
        raise HTTPException(400, 'PDF must contain readable text (up to 100 pages / 100000 characters)') from None


def needs_reencode(image, data, mime):
    return mime in {'image/heic', 'image/heif'} or len(data) > VISION_MAX_BYTES or max(image.size) > VISION_MAX_SIDE


def vision_image(data, mime):
    """Validate an image and re-encode HEIC or oversized photos as a bounded JPEG."""
    from PIL import Image
    import pillow_heif
    pillow_heif.register_heif_opener()
    try:
        with Image.open(BytesIO(data)) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise HTTPException(413, 'Image exceeds 40 megapixels')
            if not needs_reencode(image, data, mime):
                image.verify()
                return data, mime
            image = image.convert('RGB')
            image.thumbnail((VISION_MAX_SIDE, VISION_MAX_SIDE))
            output = BytesIO()
            image.save(output, format='JPEG', quality=JPEG_QUALITY)
            return output.getvalue(), 'image/jpeg'
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(413, 'Image exceeds 40 megapixels') from None
    except Exception:
        raise HTTPException(400, 'Invalid image') from None


def letter_summary(data, mime, note):
    from vali_media.letters import read_letter, read_letter_text
    if mime == 'application/pdf':
        return read_letter_text(pdf_text(data), note)
    return read_letter(*vision_image(data, mime), note)

"""Bounded uploads and safe document normalization; never persist originals."""
from io import BytesIO

from fastapi import HTTPException

MAX_UPLOAD = 10 * 1024 * 1024
AUDIO_TYPES = {'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/x-wav'}
LETTER_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'}


def read_upload(upload, allowed):
    data = upload.file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, 'Upload exceeds 10 MB')
    if not data:
        raise HTTPException(400, 'Empty upload')
    mime = (upload.content_type or '').split(';')[0].strip().lower()
    if mime not in allowed:
        raise HTTPException(415, 'Unsupported upload type')
    return data, mime


def letter_summary(data, mime, note):
    from vali_media.letters import read_letter, read_letter_text
    if mime == 'application/pdf':
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
        except Exception:
            raise HTTPException(400, 'PDF must contain readable text (up to 100 pages / 100000 characters)') from None
        return read_letter_text(text, note)
    if mime in {'image/heic', 'image/heif'}:
        from PIL import Image
        import pillow_heif
        pillow_heif.register_heif_opener()
        try:
            with Image.open(BytesIO(data)) as image:
                output = BytesIO()
                image.convert('RGB').save(output, format='PNG')
                data, mime = output.getvalue(), 'image/png'
        except Exception:
            raise HTTPException(400, 'Invalid HEIC image') from None
    return read_letter(data, mime, note)

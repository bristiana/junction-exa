"""Environment configuration; optional integrations expose configured booleans."""
import os
from dataclasses import dataclass, field


@dataclass
class Config:
    exa_api_key: str = field(default_factory=lambda: os.getenv('EXA_API_KEY', ''))
    anthropic_api_key: str = field(default_factory=lambda: os.getenv('ANTHROPIC_API_KEY', ''))
    model: str = field(default_factory=lambda: os.getenv('HOIDA_MODEL', 'claude-opus-5-5'))
    jev_api_key: str = field(default_factory=lambda: os.getenv('JEV_API_KEY', ''))
    database_url: str = field(default_factory=lambda: os.getenv('DATABASE_URL', ''))
    sqlite_path: str = field(default_factory=lambda: os.getenv('HOIDA_SQLITE_PATH', 'hoida.db'))
    cloudinary_url: str = field(default_factory=lambda: os.getenv('CLOUDINARY_URL', ''))
    elevenlabs_api_key: str = field(default_factory=lambda: os.getenv('ELEVENLABS_API_KEY', ''))
    whatsapp_token: str = field(default_factory=lambda: os.getenv('WHATSAPP_TOKEN', ''))
    whatsapp_phone_number_id: str = field(default_factory=lambda: os.getenv('WHATSAPP_PHONE_NUMBER_ID', ''))
    whatsapp_verify_token: str = field(default_factory=lambda: os.getenv('WHATSAPP_VERIFY_TOKEN', ''))
    whatsapp_app_secret: str = field(default_factory=lambda: os.getenv('WHATSAPP_APP_SECRET', ''))
    public_url: str = field(default_factory=lambda: os.getenv('HOIDA_PUBLIC_URL', ''))
    allowed_origins: str = field(default_factory=lambda: os.getenv('HOIDA_ALLOWED_ORIGINS', ''))
    daily_cap_usd: float = field(default_factory=lambda: float(os.getenv('HOIDA_DAILY_CAP_USD', '2.0')))

    def services(self):
        return dict(ok=True, exa=bool(self.exa_api_key), anthropic=bool(self.anthropic_api_key),
                    jev=bool(self.jev_api_key), db=True, cloudinary=bool(self.cloudinary_url),
                    whatsapp=bool(self.whatsapp_token and self.whatsapp_phone_number_id),
                    elevenlabs=bool(self.elevenlabs_api_key))

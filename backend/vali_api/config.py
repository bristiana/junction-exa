"""Environment configuration; optional integrations expose configured booleans."""
import os
import re
from dataclasses import dataclass, field


def vali_env(name: str, default: str = '') -> str:
    """Read VALI_* first; HOIDA_* remains compatible until deployments migrate.

    An explicitly empty VALI_* value overrides the legacy value too.
    """
    value = os.getenv(name)
    return value if value is not None else os.getenv(name.replace('VALI_', 'HOIDA_', 1), default)


@dataclass
class Config:
    exa_api_key: str = field(default_factory=lambda: os.getenv('EXA_API_KEY', ''))
    anthropic_api_key: str = field(default_factory=lambda: os.getenv('ANTHROPIC_API_KEY', ''))
    model: str = field(default_factory=lambda: vali_env('VALI_MODEL', 'claude-opus-5-5'))
    jev_api_key: str = field(default_factory=lambda: os.getenv('JEV_API_KEY', ''))
    database_url: str = field(default_factory=lambda: os.getenv('DATABASE_URL', ''))
    sqlite_path: str = field(default_factory=lambda: vali_env('VALI_SQLITE_PATH', 'vali.db'))
    cloudinary_url: str = field(default_factory=lambda: os.getenv('CLOUDINARY_URL', ''))
    elevenlabs_api_key: str = field(default_factory=lambda: os.getenv('ELEVENLABS_API_KEY', ''))
    elevenlabs_agent_id: str = field(default_factory=lambda: os.getenv('VALI_ELEVENLABS_AGENT_ID', ''))
    voice_tool_secret: str = field(default_factory=lambda: os.getenv('VALI_VOICE_TOOL_SECRET', ''))
    whatsapp_token: str = field(default_factory=lambda: os.getenv('WHATSAPP_TOKEN', ''))
    whatsapp_phone_number_id: str = field(default_factory=lambda: os.getenv('WHATSAPP_PHONE_NUMBER_ID', ''))
    whatsapp_verify_token: str = field(default_factory=lambda: os.getenv('WHATSAPP_VERIFY_TOKEN', ''))
    whatsapp_app_secret: str = field(default_factory=lambda: os.getenv('WHATSAPP_APP_SECRET', ''))
    whatsapp_number: str = field(default_factory=lambda: re.sub(r'\D', '', vali_env('VALI_WHATSAPP_NUMBER', '')))
    public_url: str = field(default_factory=lambda: vali_env('VALI_PUBLIC_URL', ''))
    allowed_origins: str = field(default_factory=lambda: vali_env('VALI_ALLOWED_ORIGINS', ''))
    # SHA-256 of tokens that may only read: the shared demo link judges open. Their writes get a 403.
    readonly_tokens: frozenset = field(default_factory=lambda: frozenset(t for t in vali_env('VALI_READONLY_TOKEN_HASHES', 'ca81589bcab70d6b2428ae754a57dd6c268178dfe878badad8121a2314deeaf9').split(',') if t))
    # Invite only: no new accounts, no new WhatsApp links, and only owner_ids may write.
    closed: bool = field(default_factory=lambda: vali_env('VALI_CLOSED', '') == '1')
    owner_ids: frozenset = field(default_factory=lambda: frozenset(t for t in vali_env('VALI_OWNER_IDS', 'u_aef529c006304836b977614e08d2bc5c').split(',') if t))
    daily_cap_usd: float = field(default_factory=lambda: float(vali_env('VALI_DAILY_CAP_USD', '3.0')))
    global_daily_cap_usd: float = field(default_factory=lambda: float(vali_env('VALI_GLOBAL_DAILY_CAP_USD', '60.0')))

    def services(self):
        return dict(ok=True, exa=bool(self.exa_api_key), anthropic=bool(self.anthropic_api_key),
                    jev=bool(self.jev_api_key), db=True, cloudinary=bool(self.cloudinary_url),
                    whatsapp=bool(self.whatsapp_token and self.whatsapp_phone_number_id),
                    whatsapp_signed=bool(self.whatsapp_app_secret),
                    elevenlabs=bool(self.elevenlabs_api_key), voice_agent=self.voice_agent_ready())

    def voice_agent_ready(self):
        return bool(self.elevenlabs_api_key and self.elevenlabs_agent_id and self.voice_tool_secret)

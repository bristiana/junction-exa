"""The rename preserves legacy deployments without overriding new settings."""
import pytest

from vali_api.config import Config, vali_env


@pytest.mark.parametrize('suffix,attribute,legacy,new,default', [
    ('MODEL', 'model', 'legacy-model', 'new-model', 'claude-opus-5-5'),
    ('SQLITE_PATH', 'sqlite_path', 'existing.db', 'new.db', 'vali.db'),
    ('PUBLIC_URL', 'public_url', 'https://old.example', 'https://new.example', ''),
    ('ALLOWED_ORIGINS', 'allowed_origins', 'https://old.example', 'https://new.example', ''),
    ('DAILY_CAP_USD', 'daily_cap_usd', '3.5', '4.5', 10.0),
    ('EFFORT', None, 'low', 'high', ''),
    ('PRICES', None, '1,2,3,4', '5,6,7,8', ''),
])
def test_env_migration(monkeypatch, suffix, attribute, legacy, new, default):
    name, old_name = 'VALI_' + suffix, 'HOIDA_' + suffix
    monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv(old_name, raising=False)

    def read():
        return getattr(Config(), attribute) if attribute else vali_env(name)

    convert = float if suffix == 'DAILY_CAP_USD' else str
    assert read() == default
    monkeypatch.setenv(old_name, legacy)
    assert read() == convert(legacy)
    monkeypatch.setenv(name, new)
    assert read() == convert(new)
    monkeypatch.setenv(name, '')
    assert vali_env(name, 'default') == ''
    if suffix != 'DAILY_CAP_USD':
        assert read() == ''

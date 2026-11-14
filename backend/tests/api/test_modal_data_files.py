"""add_local_python_source ships only .py files, so every data file a package loads must be added to the image."""
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
PACKAGES = ('vali_api', 'vali_agent', 'vali_media', 'vali_wa')


def data_files():
    for package in PACKAGES:
        for path in (BACKEND / package).rglob('*'):
            if path.is_file() and path.suffix not in {'.py', '.pyc', '.md'}:
                yield path.relative_to(BACKEND).as_posix()


def test_every_package_data_file_is_shipped_to_modal():
    images = (BACKEND / 'modal_app.py').read_text() + (BACKEND / 'modal_sandbox.py').read_text()
    missing = [f for f in data_files() if f.split('/', 1)[1] not in images.replace("' / '", '/')]
    assert not missing, f'add these to the Modal image: {missing}'

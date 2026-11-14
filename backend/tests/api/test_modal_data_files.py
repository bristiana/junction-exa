"""add_local_python_source ships only .py files, so every data file a package loads must be added to the image."""
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
PACKAGES = ('vali_api', 'vali_agent', 'vali_media', 'vali_wa')


def data_files():
    for package in PACKAGES:
        for path in (BACKEND / package).rglob('*'):
            if path.is_file() and path.suffix not in {'.py', '.pyc', '.md'}:
                yield path.relative_to(BACKEND).as_posix()


@pytest.mark.parametrize('image_file', ['modal_app.py', 'modal_sandbox.py'])
def test_every_package_data_file_is_shipped_to_modal(image_file):
    # Each app builds its own image from the same packages, so each must ship every data file.
    image = (BACKEND / image_file).read_text().replace("' / '", '/')
    missing = [f for f in data_files() if f.split('/', 1)[1] not in image]
    assert not missing, f'add these to the image in {image_file}: {missing}'

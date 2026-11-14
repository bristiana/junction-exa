"""The browser sandbox as its own Modal app, deployed separately from the API.

    modal deploy backend/modal_sandbox.py      # app "hoida-sandbox", function "browser_session"

The API (modal_app.py, app "hoida") spawns it by name, so deploying one never replaces the other.
Both read the secret "hoida" and share the Postgres store, where the sandbox writes steps, shots,
live frames, usage and the approval state.
"""
from pathlib import Path
import modal

app = modal.App('hoida-sandbox')
image = (
    modal.Image.debian_slim(python_version='3.13')
    .pip_install_from_requirements(str(Path(__file__).with_name('requirements.txt')))
    .run_commands('playwright install --with-deps chromium')
    .add_local_python_source('hoida_api', 'hoida_agent')
)
secret = modal.Secret.from_name('hoida')


@app.function(image=image, secrets=[secret], timeout=900, cpu=2, memory=4096)
def browser_session(task_id: str, goal: str, start_url: str, profile: dict):
    from hoida_api.app import create_app, run_browser_session
    from hoida_api.config import Config
    from hoida_api.store import make_store
    config = Config()
    if not config.database_url:
        raise RuntimeError('DATABASE_URL is required: the sandbox writes to the shared store')
    application = create_app(config=config, store=make_store(config),
                             spawn_research_poller=lambda tid: None, spawn_browser_session=lambda *args: None)
    try:
        run_browser_session(task_id, goal, start_url, profile, application)
    finally:
        application.state.exa.close()
        application.state.store.close()

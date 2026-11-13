"""Modal web API and isolated research/browser workers."""
from pathlib import Path
import modal

app = modal.App('hoida')
image = (
    modal.Image.debian_slim(python_version='3.13')
    .pip_install_from_requirements(str(Path(__file__).with_name('requirements.txt')))
    .run_commands('playwright install --with-deps chromium')
    .add_local_python_source('hoida_api', 'hoida_agent')
)
secret = modal.Secret.from_name('hoida')


def worker_app():
    from hoida_api.app import create_app
    from hoida_api.config import Config
    from hoida_api.store import make_store
    config = Config()
    if not config.database_url:
        raise RuntimeError('DATABASE_URL is required for shared Modal worker state')
    return create_app(config=config, store=make_store(config),
                      spawn_research_poller=lambda tid: research_poller.spawn(tid),
                      spawn_browser_session=lambda tid, goal, url, profile: browser_session.spawn(tid, goal, url, profile))


@app.function(image=image, secrets=[secret])
@modal.asgi_app()
def web():
    return worker_app()


@app.function(image=image, secrets=[secret], timeout=900)
def research_poller(task_id: str):
    from hoida_api.app import research_poller_loop
    application = worker_app()
    try:
        research_poller_loop(task_id, application)
    finally:
        application.state.exa.close()
        application.state.store.close()


@app.function(image=image, secrets=[secret], timeout=900, cpu=2, memory=4096)
def browser_session(task_id: str, goal: str, start_url: str, profile: dict):
    from hoida_api.app import run_browser_session
    application = worker_app()
    try:
        # The shared runner imports the browser agent lazily and persists its hooks.
        run_browser_session(task_id, goal, start_url, profile, application)
    finally:
        application.state.exa.close()
        application.state.store.close()

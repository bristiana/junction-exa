"""Modal web API and isolated research/browser workers."""
from pathlib import Path
import modal

app = modal.App('vali')
image = (
    modal.Image.debian_slim(python_version='3.13')
    .pip_install_from_requirements(str(Path(__file__).with_name('requirements.txt')))
    .run_commands('playwright install --with-deps chromium')
    .add_local_python_source('vali_api', 'vali_agent', 'vali_media', 'vali_wa')
    .add_local_dir(str(Path(__file__).resolve().parent.parent / 'web'), '/root/web')
    # add_local_python_source ships only .py files; package data goes in explicitly.
    .add_local_file(str(Path(__file__).with_name('vali_api') / 'services' / 'catalog.json'),
                    '/root/vali_api/services/catalog.json')
)
secret = modal.Secret.from_name('vali')


def worker_app():
    from vali_api.app import create_app
    from vali_api.config import Config
    from vali_api.store import make_store
    config = Config()
    if not config.database_url:
        raise RuntimeError('DATABASE_URL is required for shared Modal worker state')
    return create_app(config=config, store=make_store(config),
                      spawn_research_poller=lambda tid: research_poller.spawn(tid),
                      spawn_browser_session=spawn_browser_session)


def spawn_browser_session(tid, goal, url, profile):
    # The sandbox is its own app ("vali-sandbox", modal_sandbox.py) so the two deploy independently.
    # Falls back to this app's copy while the sandbox app is not deployed.
    try:
        return modal.Function.from_name('vali-sandbox', 'browser_session').spawn(tid, goal, url, profile)
    except modal.exception.NotFoundError:
        return browser_session.spawn(tid, goal, url, profile)


# One warm container keeps webhooks and the extension fast; it shares one DB connection.
@app.function(image=image, secrets=[secret], min_containers=1, max_containers=2)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    import logging
    from vali_api.app import research_poller_loop, spawn_thread
    logging.basicConfig(level=logging.INFO, force=True)
    application = worker_app()
    # A quote check needs no cold research_poller container: run it in this warm one.
    application.state.spawn_quote_check = lambda tid: spawn_thread(research_poller_loop, tid, application)
    return application


@app.function(image=image, secrets=[secret], timeout=900)
def research_poller(task_id: str):
    from vali_api.app import research_poller_loop
    application = worker_app()
    try:
        research_poller_loop(task_id, application)
    finally:
        application.state.exa.close()
        application.state.store.close()


@app.function(image=image, secrets=[secret], timeout=900, cpu=2, memory=4096)
def browser_session(task_id: str, goal: str, start_url: str, profile: dict):
    from vali_api.app import run_browser_session
    application = worker_app()
    try:
        # The shared runner imports the browser agent lazily and persists its hooks.
        run_browser_session(task_id, goal, start_url, profile, application)
    finally:
        application.state.exa.close()
        application.state.store.close()

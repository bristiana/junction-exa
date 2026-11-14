// Lets the mascot window stop drawing. Butler (extension/lib/butler.js) asks for every animation frame, which is wasted
// while Vali sleeps or stands still under Reduce motion. Loaded before butler.js: pause() holds the next frame request,
// resume() lets it run again.
(() => {
  const request = window.requestAnimationFrame.bind(window);
  let paused = false, held = [];
  window.requestAnimationFrame = callback => (paused ? (held.push(callback), 0) : request(callback));
  window.ValiFrames = {
    pause() { paused = true; },
    resume() {
      if (!paused) return;
      paused = false;
      const callbacks = held; held = [];
      for (const callback of callbacks) request(callback);
    },
    get paused() { return paused; },
  };
})();

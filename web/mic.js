// The mic button: record while pressed once, stop on the second press, and put the transcript in the ask box.
import { api } from './api.js';

export function startMic(button, { onText, onError }) {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    button.hidden = true;
    return;
  }
  let recorder = null;
  button.addEventListener('click', async () => {
    if (recorder) return recorder.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => chunks.push(event.data);
      recorder.onstop = () => finish(stream, new Blob(chunks, { type: recorder.mimeType.split(';')[0] }));
      recorder.start();
      button.classList.add('recording');
      button.setAttribute('aria-label', 'Stop recording');
    } catch {
      onError('The microphone is blocked. You can type the errand instead.');
    }
  });

  async function finish(stream, blob) {
    stream.getTracks().forEach((track) => track.stop());
    recorder = null;
    button.classList.remove('recording');
    button.setAttribute('aria-label', 'Speak your errand');
    try {
      onText((await api.transcribe(blob)).text);
    } catch (error) {
      onError(`Couldn't hear that: ${error.message}`);
    }
  }
}

// Talk to Vali: a live voice conversation with the ElevenLabs agent (@elevenlabs/client, vendor/elevenlabs/client.js).
// Main asks the Vali server for a one-off credential (POST /v1/voice/session); the agent does errands through its
// server tools, so this side only plays the conversation and reports its state.
import { micError, caption } from '../logic.mjs';

// show({ mode, caption, who, ended, error, mic }) gets every change: mode is '', 'connecting', 'listening' or 'speaking';
// who says whose words the caption is ('vali' or 'you'); ended is true when a call hangs up without an error.
export function createTalk({ show, level, expose = false }) {
  let convo = null, starting = false, cancelled = false, raf = 0, mode = '';
  const log = { modes: [], captions: [], heard: [], errors: [] };
  if (expose) window.__talk = log; // only for npm run talk-check
  const report = next => { mode = next; log.modes.push(next); show({ mode: next }); window.vali.call('talk', next); };

  // The ring and mouth follow the voice: the agent's volume while it speaks, the user's while it listens.
  const volume = () => (mode === 'speaking' ? convo.getOutputVolume?.() : convo.getInputVolume?.()) || 0;
  function meter() {
    if (!convo) return;
    level(Math.min(1, volume() * 2.5));
    raf = requestAnimationFrame(meter);
  }
  function end(error = '') {
    const wasLive = !!convo;
    cancelAnimationFrame(raf); convo = null; level(0);
    if (error) log.errors.push(error);
    report('');
    if (error) show({ error, mic: /microphone/i.test(error) });
    else if (wasLive) show({ ended: true });
  }
  // Captions: Vali's lines and, briefly, what the user said. A Vali line usually follows an errand tool call, so the
  // list refreshes then too, in case the agent does not send tool events.
  function heard({ role, source, message }) {
    const vali = role === 'agent' || source === 'ai', line = caption(message, vali ? 110 : 80);
    if (!line) return;
    (vali ? log.captions : log.heard).push(line);
    show({ caption: line, who: vali ? 'vali' : 'you' });
    if (vali) refresh();
  }
  const refresh = () => window.vali.call('message', { type: 'poll' }).catch(() => {});
  async function start() {
    if (convo || starting) return;
    starting = true; cancelled = false; report('connecting');
    try {
      const access = await window.vali.call('mic');
      if (!access.granted) throw new Error(micError({ name: 'NotAllowedError' }));
      const r = await window.vali.call('talkSession');
      if (!r.ok) throw new Error(r.error);
      if (cancelled) { end(); return; }
      const s = r.data;
      const session = await window.ElevenLabsClient.Conversation.startSession({
        conversationToken: s.conversation_token, connectionType: 'webrtc', dynamicVariables: s.dynamic_variables,
        onModeChange: m => { if ((convo || starting) && !cancelled) report(m.mode); },
        onMessage: heard,
        // The agent just created, approved or stopped an errand: refresh the list now instead of in four seconds.
        onAgentToolResponse: refresh,
        onDisconnect: d => { if (convo) end(d?.reason === 'error' ? 'The voice connection dropped. Try again.' : ''); },
        onError: message => log.errors.push(String(message)),
      });
      if (cancelled) { await session.endSession(); end(); return; }
      convo = session; if (mode === 'connecting') report('listening'); meter();
    } catch (e) {
      end(micError(e) || e.message || 'Could not start talking. Try again.');
    } finally { starting = false; }
  }
  async function stop() {
    if (starting) { cancelled = true; return; }
    const c = convo; if (!c) return;
    end();
    await c.endSession().catch(() => {});
  }
  return { start, stop, toggle: () => (convo || starting ? stop() : start()), get active() { return !!convo || starting; } };
}

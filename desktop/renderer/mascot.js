const mascot = Butler.create(document.getElementById('mascot'), { palette: 'lilac', state: 'idle', reducedMotion: 'auto', trackPointer: true });
const words = { idle: 'At your service', working: 'Taking care of it', needs_approval: 'I need your attention', success: 'All taken care of', error: 'Let’s check what happened' };
function update(s) { mascot.setState(s.pose); document.getElementById('status').textContent = s.paused ? 'Paused' : words[s.pose]; }
window.vali.onState(update);
window.vali.call('state').then(update);
document.getElementById('mascot').onclick = () => window.vali.call('chat');

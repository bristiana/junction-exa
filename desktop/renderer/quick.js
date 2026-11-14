document.querySelector('form').onsubmit = async e => {
  e.preventDefault(); const input = document.getElementById('errand'), button = document.querySelector('button');
  if (!input.value.trim() || button.disabled) return;
  button.disabled = true;
  try { const r = await window.vali.call('message', { type: 'start', task: input.value.trim() }); if (!r.ok) throw new Error(r.error); input.value = ''; await window.vali.call('hideQuick'); }
  catch (error) { document.getElementById('error').textContent = error.message; }
  finally { button.disabled = false; }
};
window.addEventListener('keydown', e => { if (e.key === 'Escape') window.vali.call('hideQuick'); });
window.addEventListener('focus', () => document.getElementById('errand').focus());

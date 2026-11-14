// The answer view (first cut): the answer text and how the research ended.
import { h, show } from './dom.js';
import { structured } from './model.js';

export function renderAnswer(task) {
  const research = task.research || {};
  show('answer',
    h('a', { class: 'back', href: '#/' }, '← New errand'),
    h('p', { class: 'eyebrow' }, task.task),
    h('h2', { class: 'headline' }, structured(task).answer || research.error || 'Vali stopped this errand.'));
}

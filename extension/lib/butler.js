/* Butler v6 "Tutor & doer" — animated mascot library. No dependencies. See README.md */
/* ==================================================================
   Butler v5 — playful soft glossy owl-butler
   ================================================================== */
(function (global) {
  'use strict';

  const STATES = ['idle', 'listening', 'thinking', 'working', 'teaching', 'checking', 'needs_approval', 'success', 'error'];

  /* ---------- Palettes ----------
     b* body, c* crest, iri* iridescent rim, accent2 = hat feather / confetti. */
  const PALETTES = {
    holo:   { label: 'Holo',   b0: '#c9f3ff', b1: '#e7d0ff', b2: '#ffd6ec', c0: '#d4fff3', c1: '#d6dcff', c2: '#ffd9f2',
              shadow: '#a9b8e0', blush: '#ff9fd0', brow: '#7d79c4', accent: '#8f7bff', accentDk: '#6c58e6', accent2: '#ffb86b',
              iri0: '#9ff7ff', iri1: '#ffb3ff', iri2: '#fff3a0' },
    sorbet: { label: 'Sorbet', b0: '#ffd3b5', b1: '#ffc1d6', b2: '#fff0b3', c0: '#ffe1a8', c1: '#ffc9b8', c2: '#ffbfd9',
              shadow: '#e8b3a6', blush: '#ff8fa3', brow: '#b87363', accent: '#ff6f91', accentDk: '#e04f74', accent2: '#5fc9b8',
              iri0: '#fff6a8', iri1: '#ffb3d9', iri2: '#a8f0e6' },
    lilac:  { label: 'Lilac',  b0: '#d6c8f7', b1: '#f4c7e4', b2: '#c3d4f9', c0: '#bccff9', c1: '#d8c4f4', c2: '#f1c4e6',
              shadow: '#b3a2da', blush: '#ff9cc2', brow: '#8273b8', accent: '#f27aa5', accentDk: '#d9558a', accent2: '#ffd36e',
              iri0: '#bff0ff', iri1: '#ffc4ea', iri2: '#fff2b0' },
    matcha: { label: 'Matcha', b0: '#d9f2c4', b1: '#f6efc9', b2: '#c9ecd9', c0: '#c8eab3', c1: '#e6f3c6', c2: '#f7e8c4',
              shadow: '#a9c9a0', blush: '#ffaab0', brow: '#6f9a62', accent: '#f28c6b', accentDk: '#d86a4a', accent2: '#ff9cc2',
              iri0: '#fffbd0', iri1: '#d0ffe6', iri2: '#ffd6e6' }
  };
  const INK = '#1f2035', COAT0 = '#43466a', COAT1 = '#23253b';

  /* ---------- SVG template ---------- */
  function template(u, C) {
    const id = (n) => `${n}-${u}`, url = (n) => `url(#${n}-${u})`;
    const star = 'M0 -6 Q1 -1 6 0 Q1 1 0 6 Q-1 1 -6 0 Q-1 -1 0 -6 Z';
    const heart = 'M0 4 C-7 -1 -5 -8 0 -4.5 C5 -8 7 -1 0 4 Z';
    const glove = (tx) => `<circle cx="${tx}" cy="-4" r="3.8" fill="${url('glove')}" stroke="#dcd5ee" stroke-width="1"/>
      <circle r="8.5" fill="${url('glove')}" stroke="#dcd5ee" stroke-width="1"/>
      <ellipse cx="-2.5" cy="-3.5" rx="3" ry="2" fill="#fff" opacity=".9"/>`;
    const confColors = [C.accent, C.accent2, C.iri0, C.iri1, C.blush, C.accentDk];
    const confetti = confColors.map((c, i) =>
      `<rect data-p="conf${i}" x="-2.5" y="-4" width="5" height="8" rx="1.5" fill="${c}" opacity="0"/>`).join('');
    return `
<svg viewBox="-10 -20 220 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Butler, your assistant">
  <defs>
    <linearGradient id="${id('body')}" x1="0" y1="0" x2=".3" y2="1">
      <stop offset="0" stop-color="${C.b0}"/><stop offset=".55" stop-color="${C.b1}"/><stop offset="1" stop-color="${C.b2}"/>
    </linearGradient>
    <linearGradient id="${id('crest')}" x1="0" y1="0" x2=".5" y2="1">
      <stop offset="0" stop-color="${C.c0}"/><stop offset=".5" stop-color="${C.c1}"/><stop offset="1" stop-color="${C.c2}"/>
    </linearGradient>
    <linearGradient id="${id('rim')}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="${C.iri0}"/><stop offset=".5" stop-color="${C.iri1}"/><stop offset="1" stop-color="${C.iri2}"/>
    </linearGradient>
    <linearGradient id="${id('coat')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COAT0}"/><stop offset="1" stop-color="${COAT1}"/>
    </linearGradient>
    <linearGradient id="${id('tie')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.accent}"/><stop offset="1" stop-color="${C.accentDk}"/>
    </linearGradient>
    <linearGradient id="${id('gold')}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff1b8"/><stop offset=".5" stop-color="#e6b54a"/><stop offset="1" stop-color="#fbe3a0"/>
    </linearGradient>
    <radialGradient id="${id('glove')}" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e1f4"/>
    </radialGradient>
    <linearGradient id="${id('silver')}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6f7fc"/><stop offset="1" stop-color="#c5cbe0"/>
    </linearGradient>
    <filter id="${id('blur6')}" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>
    <filter id="${id('blur2')}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"/></filter>
    <clipPath id="${id('bodyClip')}"><circle cx="100" cy="112" r="50"/></clipPath>
    <clipPath id="${id('dome')}"><path d="M-18 -1 A18 17 0 0 1 18 -1 Z"/></clipPath>
    <clipPath id="${id('lapClip')}"><rect x="-20" y="-28" width="40" height="19"/></clipPath>
  </defs>

  <ellipse data-p="shadow" cx="100" cy="196" rx="40" ry="7" fill="${C.shadow}" filter="${url('blur6')}"/>

  <g data-p="float"><g data-p="lean"><g data-p="body">
    <path d="M68 150 Q58 164 56 175 Q68 171 80 160 Z" fill="${url('coat')}"/>
    <path d="M132 150 Q142 164 144 175 Q132 171 120 160 Z" fill="${url('coat')}"/>

    <circle cx="100" cy="112" r="50" fill="${url('body')}"/>
    <g clip-path="${url('bodyClip')}">
      <!-- bounce light from the floor -->
      <ellipse cx="100" cy="160" rx="34" ry="9" fill="${C.iri0}" opacity=".55" filter="${url('blur2')}"/>
      <path d="M40 133 Q66 124 88 128 L100 153 L112 128 Q134 124 160 133 L160 175 L40 175 Z" fill="${url('coat')}"/>
      <path d="M88 128 Q100 125 112 128 L100 153 Z" fill="#ffffff"/>
      <path d="M88 128 L100 153 L112 128" fill="none" stroke="#565a86" stroke-width="2.5" stroke-linejoin="round"/>
      <ellipse cx="72" cy="146" rx="14" ry="5" fill="#fff" opacity=".14" transform="rotate(-20 72 146)"/>
      <!-- pocket square -->
      <path d="M120 136 L126 131 L129 137 L132 133 L133 140 L120 140 Z" fill="${C.accent2}"/>
    </g>
    <!-- iridescent rim -->
    <circle cx="100" cy="112" r="48.6" fill="none" stroke="${url('rim')}" stroke-width="3" opacity=".7"/>
    <circle cx="100" cy="141" r="1.8" fill="${COAT1}"/>
    <circle cx="100" cy="147" r="1.8" fill="${COAT1}"/>
    <ellipse cx="66" cy="114" rx="5" ry="13" fill="#fff" opacity=".45" filter="${url('blur2')}"/>
    <rect x="61" y="99" width="7" height="3.2" rx="1.6" fill="#fff" opacity=".95" transform="rotate(-62 64 100)"/>
    <circle cx="68" cy="94" r="1.6" fill="#fff"/>
    <ellipse cx="100" cy="94" rx="38" ry="6" fill="${C.shadow}" opacity=".35" filter="${url('blur2')}"/>

    <g data-p="crest">
      <g data-p="earL"><ellipse cx="72" cy="70" rx="22" ry="27" fill="${url('crest')}"/></g>
      <g data-p="earR"><ellipse cx="128" cy="70" rx="22" ry="27" fill="${url('crest')}"/></g>
      <circle cx="100" cy="68" r="27" fill="${url('crest')}"/>
      <path d="M58 82 A27 27 0 0 1 60 52" fill="none" stroke="${url('rim')}" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>
      <ellipse cx="82" cy="54" rx="12" ry="5.5" fill="#fff" opacity=".9" transform="rotate(-28 82 54)" filter="${url('blur2')}"/>
      <circle cx="74" cy="64" r="2.2" fill="#fff" opacity=".95"/>
      <path d="${star}" fill="#fff" opacity=".9" transform="translate(88 50) scale(.45)"/>
      <ellipse cx="132" cy="58" rx="6" ry="3" fill="#fff" opacity=".5" transform="rotate(25 132 58)" filter="${url('blur2')}"/>
      <g data-p="hat">
        <!-- jaunty feather tucked in the band -->
        <path d="M107 38 Q121 26 119 10 Q113 22 104 34 Z" fill="${C.accent2}" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>
        <path d="M106 35 Q114 26 117 15" fill="none" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".8"/>
        <path d="M90.5 42 L89 20 Q100 17 111 20 L109.5 42 Z" fill="${url('coat')}"/>
        <path d="M90 36 L110 36 L109.7 40.5 L90.3 40.5 Z" fill="${C.accent}"/>
        <path d="M93.5 23 L94 33" stroke="#6a6e9c" stroke-width="2.4" stroke-linecap="round"/>
        <ellipse cx="100" cy="42" rx="17" ry="3.8" fill="${url('coat')}"/>
      </g>
    </g>

    <g data-p="face">
      <ellipse cx="70" cy="117" rx="7.5" ry="4.5" data-p="blushL" fill="${C.blush}" filter="${url('blur2')}"/>
      <ellipse cx="130" cy="117" rx="7.5" ry="4.5" data-p="blushR" fill="${C.blush}" filter="${url('blur2')}"/>
      <g data-p="eyeL"><ellipse cx="84" cy="104" rx="6.5" ry="7.5" fill="${INK}"/><circle cx="82" cy="101" r="2.4" fill="#fff"/><circle cx="86.2" cy="106.6" r="1" fill="#fff"/><circle cx="86" cy="100" r=".7" fill="${C.iri0}"/></g>
      <g data-p="eyeR"><ellipse cx="116" cy="104" rx="6.5" ry="7.5" fill="${INK}"/><circle cx="114" cy="101" r="2.4" fill="#fff"/><circle cx="118.2" cy="106.6" r="1" fill="#fff"/><circle cx="118" cy="100" r=".7" fill="${C.iri0}"/></g>
      <path data-p="happy" d="M77 106 Q84 98 91 106 M109 106 Q116 98 123 106" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" opacity="0"/>
      <path data-p="squint" d="M79 99 L88 104 L79 109 M121 99 L112 104 L121 109" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0"/>
      <path data-p="browL" d="M79 91 L89 91" stroke="${C.brow}" stroke-width="2.6" stroke-linecap="round" opacity=".75"/>
      <path data-p="browR" d="M111 91 L121 91" stroke="${C.brow}" stroke-width="2.6" stroke-linecap="round" opacity=".75"/>
      <path d="M96.5 111 Q100 109.5 103.5 111 Q101 116 100 116 Q99 116 96.5 111 Z" fill="#ffb18e" stroke="#ffb18e" stroke-width="1.5" stroke-linejoin="round"/>
      <path data-p="smile" d="M95 119.5 Q100 123.5 105 119.5" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" opacity="0"/>
      <path data-p="mouthO" d="M100 118 m-2.6 0 a2.6 3.2 0 1 0 5.2 0 a2.6 3.2 0 1 0 -5.2 0" fill="${INK}" opacity="0"/>
      <path data-p="sweat" d="M136 86 Q141 94 136 98 Q131 94 136 86 Z" fill="#a9d6f2" opacity="0"/>
      <!-- monocle on a chain (pops off on error) -->
      <g data-p="monocle">
        <path d="M126 108 Q130 122 114 130" fill="none" stroke="${url('gold')}" stroke-width="1.4" stroke-dasharray="2 1.6" stroke-linecap="round"/>
        <circle cx="116" cy="104" r="10.5" fill="#fff" fill-opacity=".16" stroke="${url('gold')}" stroke-width="2.4"/>
        <path d="M109.5 99 A8 8 0 0 1 116 95.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".9"/>
      </g>
    </g>

    <g data-p="tie">
      <path d="M100 130 L89 124 Q87 130 89 136 Z" fill="${url('tie')}" stroke="${C.accentDk}" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M100 130 L111 124 Q113 130 111 136 Z" fill="${url('tie')}" stroke="${C.accentDk}" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="96.6" y="126.6" width="6.8" height="6.8" rx="2.4" fill="${C.accentDk}"/>
      <circle cx="92" cy="128" r="1" fill="#fff" opacity=".8"/><circle cx="92.5" cy="132" r=".9" fill="#fff" opacity=".7"/>
      <circle cx="108" cy="128" r="1" fill="#fff" opacity=".8"/><circle cx="107.5" cy="132" r=".9" fill="#fff" opacity=".7"/>
    </g>

    <g data-p="trayC" opacity="0"><g>
      <ellipse cx="0" cy="0" rx="24" ry="4.5" fill="#b9c0d8"/>
      <ellipse cx="0" cy="-1.5" rx="23" ry="3.6" fill="#f3f5fb"/>
      <path d="M-18 -1 A18 17 0 0 1 18 -1 Z" fill="${url('silver')}"/>
      <g clip-path="${url('dome')}"><rect data-p="shimmer" x="-60" y="-20" width="7" height="22" fill="#fff" opacity=".95" transform="skewX(-20)"/></g>
      <path d="M-11 -6 A12 11 0 0 1 -4 -13" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="0" cy="-19" r="3.2" fill="${C.accent2}"/>
    </g></g>
    <g data-p="trayK" opacity="0"><g>
      <ellipse cx="0" cy="0" rx="24" ry="4.5" fill="#b9c0d8"/>
      <ellipse cx="0" cy="-1.5" rx="23" ry="3.6" fill="#f3f5fb"/>
      <g transform="rotate(-8)">
        <rect x="-11" y="-17" width="22" height="14" rx="2" fill="#fffaf5" stroke="#eadff0" stroke-width="1"/>
        <rect x="-7" y="-13" width="10" height="1.8" rx=".9" fill="#d6cde3"/>
        <rect x="-7" y="-9.5" width="7" height="1.8" rx=".9" fill="#d6cde3"/>
        <path d="${heart}" fill="${C.accent}" transform="translate(6 -7) scale(.55)"/>
      </g>
    </g></g>
    <g data-p="glass" opacity="0">
      <path d="M0 0 L7 -9" stroke="${COAT0}" stroke-width="4.5" stroke-linecap="round"/>
      <circle cx="12" cy="-16" r="9" fill="#e3f1fb" fill-opacity=".85" stroke="${url('gold')}" stroke-width="3.5"/>
      <path d="M7 -18.5 A6 6 0 0 1 12 -22" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    </g>

    <!-- WORK: floating laptop (code scrolls, progress fills) -->
    <g data-p="lap" opacity="0">
      <path d="M-27 0 L27 0 L31 6 Q31 8 29 8 L-29 8 Q-31 8 -31 6 Z" fill="${url('silver')}" stroke="#b9c0d8" stroke-width="1"/>
      <path d="M-9 4 L9 4" stroke="#b9c0d8" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="-23" y="-31" width="46" height="31" rx="3.5" fill="${COAT1}" stroke="#565a86" stroke-width="1.5"/>
      <g clip-path="${url('lapClip')}"><g data-p="code">
        ${[0,1,2,3,4,5,6,7,8,9,10,11].map((i) => {
          const w = [22, 14, 28, 18, 10, 24][i % 6], x = -17 + [0, 4, 4, 8, 4, 0][i % 6];
          const c = [C.iri0, C.iri1, C.accent2, C.iri2, C.iri1, C.iri0][i % 6];
          return `<rect x="${x}" y="${-26 + i * 4}" width="${w}" height="2" rx="1" fill="${c}" opacity=".9"/>`;
        }).join('')}
      </g></g>
      <rect x="-18" y="-6" width="36" height="2.4" rx="1.2" fill="#3a3d5c"/>
      <rect data-p="prog" x="-18" y="-6" width="0" height="2.4" rx="1.2" fill="${C.accent}"/>
      <path d="M-20 -29 L-4 -29" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".25"/>
    </g>

    <!-- TEACH: floating app window he walks you through -->
    <g data-p="scr" opacity="0">
      <rect x="-26" y="-20" width="52" height="40" rx="5" fill="#fff" stroke="${C.iri1}" stroke-width="1.6"/>
      <path d="M-26 -15 A5 5 0 0 1 -21 -20 L21 -20 A5 5 0 0 1 26 -15 L26 -13 L-26 -13 Z" fill="${C.c1}"/>
      <circle cx="-21.5" cy="-16.5" r="1.3" fill="#ff8f8f"/><circle cx="-17.5" cy="-16.5" r="1.3" fill="#ffd36e"/><circle cx="-13.5" cy="-16.5" r="1.3" fill="#7fd8a4"/>
      ${[0,1,2].map((i) => `
        <rect x="-21" y="${-5.75 + 9 * i}" width="${[22, 16, 19][i]}" height="3.5" rx="1.75" fill="#e4e0f0"/>
        <rect x="6" y="${-6.5 + 9 * i}" width="15" height="5" rx="2.5" fill="${C.c1}"/>`).join('')}
      <rect data-p="hilite" x="4.5" y="-8" width="18" height="8" rx="4" fill="none" stroke="${C.accent}" stroke-width="1.6" opacity="0"/>
      <circle data-p="ripple" r="2" fill="none" stroke="${C.accent}" stroke-width="1.4" opacity="0"/>
      <path data-p="cursor" d="M0 0 L0 9 L2.6 6.6 L4.6 10.6 L6.2 9.8 L4.3 6 L7.6 5.8 Z" fill="${INK}" stroke="#fff" stroke-width="1" stroke-linejoin="round" opacity="0"/>
      <g data-p="check" opacity="0">
        <circle r="12" fill="#e7f8ef" stroke="#3fb27f" stroke-width="1.5"/>
        <path data-p="checkPath" d="M-6 0 L-1.5 4.5 L6.5 -4.5" fill="none" stroke="#2f9a6a" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="20" stroke-dashoffset="20"/>
      </g>
      <g data-p="dots">
        <circle data-p="dot0" cx="-6" cy="25" r="2" fill="${C.accent}"/>
        <circle data-p="dot1" cx="0" cy="25" r="2" fill="${C.accent}"/>
        <circle data-p="dot2" cx="6" cy="25" r="2" fill="${C.accent}"/>
      </g>
    </g>

    <!-- LISTEN: note pad with lines that write themselves -->
    <g data-p="pad" opacity="0">
      <rect x="-10" y="-26" width="20" height="24" rx="2.5" fill="#fffdf6" stroke="#e6dcc8" stroke-width="1"/>
      <path d="M-6 -26 v-2 M-2 -26 v-2 M2 -26 v-2 M6 -26 v-2" stroke="#b9c0d8" stroke-width="1.4" stroke-linecap="round"/>
      <rect data-p="padL0" x="-7" y="-20" width="0" height="1.8" rx=".9" fill="${C.brow}"/>
      <rect data-p="padL1" x="-7" y="-15" width="0" height="1.8" rx=".9" fill="${C.brow}"/>
      <rect data-p="padL2" x="-7" y="-10" width="0" height="1.8" rx=".9" fill="${C.brow}"/>
      <g data-p="pencil"><path d="M0 0 L4 -10 L6.5 -9 L2.5 1 Z" fill="${C.accent2}"/><path d="M0 0 L2.5 1 L0.6 2.6 Z" fill="${INK}"/><path d="M4 -10 L6.5 -9 L7.2 -10.8 L4.7 -11.8 Z" fill="${C.blush}"/></g>
    </g>

    <!-- TEACH: pointer baton -->
    <g data-p="baton" opacity="0">
      <path d="M0 0 L0 -28" stroke="${COAT0}" stroke-width="2.6" stroke-linecap="round"/>
      <circle cy="-29" r="2.6" fill="${C.accent2}" stroke="#fff" stroke-width="1"/>
    </g>

    <g data-p="napkin">
      <path d="M-9 0 L9 0 L10.5 17 Q5 13.5 0 18 Q-5 13.5 -10.5 17 Z" fill="#fff" stroke="#e6e0f2" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M-2.5 1 L-3.5 14" stroke="#ebe6f4" stroke-width="1.5" stroke-linecap="round"/>
    </g>

    <g data-p="gloveR">${glove(-5.5)}</g>
    <g data-p="gloveL">${glove(5.5)}</g>

    <path data-p="spark1" d="${star}" fill="#ffd36e" opacity="0"/>
    <path data-p="spark2" d="${star}" fill="${C.accent}" opacity="0"/>
  </g></g></g>

  <!-- free-floating fx (not squashed with the body) -->
  <g data-p="think">
    <circle data-p="think0" cx="148" cy="62" r="3" fill="#fff" stroke="${C.iri1}" stroke-width="1.2" opacity="0"/>
    <circle data-p="think1" cx="158" cy="48" r="4.5" fill="#fff" stroke="${C.iri1}" stroke-width="1.2" opacity="0"/>
    <circle data-p="think2" cx="172" cy="30" r="7" fill="#fff" stroke="${C.iri1}" stroke-width="1.2" opacity="0"/>
  </g>
  ${confetti}
  <path data-p="heart0" d="${heart}" fill="${C.blush}" opacity="0"/>
  <path data-p="heart1" d="${heart}" fill="${C.accent}" opacity="0"/>
  <path data-p="heart2" d="${heart}" fill="${C.accent2}" opacity="0"/>
</svg>`;
  }

  /* ---------- Math helpers ---------- */
  const PI = Math.PI, DEG = PI / 180;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const win = (ph, a, b, c, d) => smooth(a, b, ph) * (1 - smooth(c, d, ph));
  const phase = (tau, period) => (tau % period) / period;
  const f = (n) => n.toFixed(2);

  /* ---------- Rig parameters ---------- */
  const REST = {
    floatY: 0, lean: 0, sqx: 0, sqy: 0,
    fx: 0, fy: 0,
    crx: 0, cry: 0, crr: 0,
    eyeOpen: 1, happy: 0, squint: 0, smile: 0, mouthO: 0, blush: 0.55,
    browL: 0, browR: -8, browLY: 0, browRY: -1.5,
    earL: 0, earR: 0,
    hatLift: 0, hatRot: -8, hatX: 0, tieRot: 0,
    rhx: 50, rhy: 142, lhx: 150, lhy: 144,
    attChin: 0, attEar: 0, attHat: 0,
    trayC: 0, trayK: 0, glass: 0, glassRot: 0,
    sweat: 0, spark: 0, think: 0, monoDrop: 0,
    lap: 0, scr: 0, pad: 0, baton: 0,              // work / teach props (0..1)
    shimmer: -1, sweatY: 0, tapY: 0, hatSpin: 0, confT: -1,   // unsmoothed ↓
    workT: 0, teachT: -1, padT: 0, checkDraw: 0, dotsOn: 0
  };
  const UNSMOOTHED = new Set(['shimmer', 'sweatY', 'tapY', 'hatSpin', 'confT', 'workT', 'teachT', 'padT', 'checkDraw', 'dotsOn']);
  // App window sits up-right of his head; rows' button centres in window space.
  const SCR = [176, 24], BTN = [[13.5, -4], [13.5, 5], [13.5, 14]], TEACH_STEP = 1.9;
  const HAT_SEAT = 5;
  const CREST_PIVOT = [100, 90], HAT_PIVOT = [100, 42], TIE = [100, 130];
  const ATTACH = { chin: [91, 121], ear: [52, 76], hatGrip: [85, 42] };

  /* ---------- State poses ---------- */
  const POSES = {
    idle(T, tau) {
      const ph = phase(tau, 8);
      // hat flip: tosses his hat, it spins once and lands
      const hop = win(ph, .10, .18, .30, .40);
      T.hatLift = 24 * hop; T.hatSpin = 360 * smooth(.14, .34, ph);
      T.fy -= 3 * hop; T.browLY -= 3 * hop; T.browRY -= 3 * hop; T.mouthO = hop;
      T.floatY -= 4 * win(ph, .36, .40, .40, .48);         // little "ta-da" bob on landing
      T.happy = win(ph, .38, .42, .5, .56);
      // then fusses with the bow tie
      const k = win(ph, .64, .70, .86, .94);
      T.rhx = lerp(T.rhx, 90, k); T.rhy = lerp(T.rhy, 131, k);
      T.tieRot = k * 8 * Math.sin(tau * 15);
      T.fy += 2 * k; T.browRY -= 2 * k;
    },
    listening(T, tau, L) {
      const side = Math.tanh(L.x * 2.5);
      T.lean += 3 + 5 * side; T.crr += 4 * side; T.fx += 2 * side;
      const tw = win(phase(tau, 2.6), 0, .04, .10, .16);
      T.earL = 14 + 7 * tw; T.earR = -14 - 7 * tw;
      T.eyeOpen = 1.15; T.browLY = -3; T.browRY = -4; T.browR = -4;
      T.attEar = 1;
      T.floatY -= 2 * Math.abs(Math.sin(tau * 2.2));       // eager little bounces
      // takes notes on a little pad while you talk
      T.pad = 1; T.padT = phase(tau, 4.2);
      T.lhx = 140; T.lhy = 132; T.fy += 2 + 2 * Math.abs(Math.sin(tau * 1.3)); // glances down at his notes
      T.lhy += 1.2 * Math.sin(tau * 14) * (T.padT < .82 ? 1 : 0);   // scribble jiggle
    },
    thinking(T, tau, L) {
      T.fx = L.x * 2 + 2 * Math.sin(tau * 0.8); T.fy = -4;
      T.crr -= 4; T.browR = -16; T.browRY = -4; T.browL = 4;
      T.attChin = 1;
      T.tapY = -3 * Math.pow(Math.abs(Math.sin(tau * 5)), 4);
      T.glass = 1; T.glassRot = 10 * Math.sin(tau * 1.7);
      T.lhx = 156 + 8 * Math.cos(tau * 1.7); T.lhy = 112 + 6 * Math.sin(tau * 3.4);
      T.think = 1;
    },
    working(T, tau, L) {
      // types away on a floating laptop, gloves taking turns on the keys
      const s = Math.sin(tau * 2 * PI / 0.9);
      T.floatY -= 1.2 * Math.abs(s); T.lean += 3; T.crr += 1.5 * s;
      T.lap = 1; T.workT = tau;
      const beat = Math.floor(tau * 7), alt = beat % 2;
      const tap = Math.pow(Math.abs(Math.sin(tau * 7 * PI)), 3);
      T.lhx = 160 + 14 * alt + ((beat * 7) % 5); T.lhy = 163 - 4 * tap;
      T.rhx = 56; T.rhy = 140;
      if (phase(tau, 6) > .7) { T.rhx = 146; T.rhy = 164 - 3 * (1 - tap); }  // second glove joins in
      T.fx = 4 + L.x * 1.5; T.fy = 3;                         // eyes on the screen
      T.browL = 6; T.browR = -6; T.browRY = 0; T.smile = .6;
      T.tieRot = 3 * Math.sin(tau * 2 * PI / 0.9 + 1);
      T.blush = .45;
    },
    teaching(T, tau, L) {
      // walks you through an app: cursor visits step 1 → 2 → 3, clicks each
      T.scr = 1; T.baton = 1; T.teachT = tau; T.dotsOn = 1;
      const u = (tau % TEACH_STEP) / TEACH_STEP;
      T.lean -= 2; T.crr += 3;
      T.fx = 4; T.fy = -2; T.browL = -4; T.browLY = -3; T.browRY = -4; T.browR = -10;
      // talks while the cursor travels, smiles once it clicks
      const talk = (1 - smooth(.42, .5, u)) * Math.max(0, Math.sin(tau * 11));
      T.mouthO = .75 * talk; T.smile = smooth(.5, .62, u);
      T.lhx = 146 + 2 * Math.sin(tau * 2); T.lhy = 100 + 2 * Math.cos(tau * 2.4);
      T.rhx = 58; T.rhy = 128 - 6 * win(u, .5, .6, .7, .85);   // little "see?" gesture on the click
      T.eyeOpen = 1.1;
    },
    checking(T, tau, L) {
      // magnifier sweeps the window, then a tick draws in
      const ph = phase(tau, 3.6);
      T.scr = 1;
      const look = 1 - smooth(.56, .64, ph);
      T.glass = look; T.glassRot = -14 + 8 * Math.sin(ph * 2 * PI * 2);
      T.lhx = lerp(148, 156 + 14 * Math.sin(ph * 2 * PI * 1.6), look);
      T.lhy = lerp(128, 40 + 4 * Math.cos(ph * 2 * PI * 3.2), look);
      T.fx = 5 * look + L.x; T.fy = -4 * look;
      T.browR = -16 * look; T.browRY = -4 * look; T.browL = 4 * look;
      T.squint = .3 * look;                                   // focused squint
      T.checkDraw = smooth(.62, .78, ph) * (1 - smooth(.94, 1, ph));
      const ok = win(ph, .7, .76, .9, .97);
      T.happy = ok; T.smile = Math.max(T.smile, ok); T.floatY -= 5 * win(ph, .7, .75, .75, .84);
      T.rhx = lerp(50, 70, ok); T.rhy = lerp(142, 120, ok);   // tiny thumbs-up height
    },
    needs_approval(T, tau) {
      const k = win(phase(tau, 3.8), .05, .2, .42, .58);
      T.fy += 5 * k; T.cry += 3 * k; T.crr -= 2 * k; T.hatRot -= 6 * k; T.sqy -= 0.03 * k;
      T.eyeOpen = 1 - 0.45 * k; T.browL = -3; T.browLY = -3; T.browRY = -4;
      T.trayK = 1; T.rhx = 28 - 3 * k; T.rhy = 146;
      T.lhx = 122; T.lhy = 142;
      T.blush = 0.55 + 0.35 * k;
    },
    success(T, tau) {
      const ph = phase(tau, 2.8);
      const up = win(ph, .02, .2, .62, .8);
      const bow = win(ph, .18, .32, .5, .66);
      const hop = win(ph, .68, .75, .75, .86);
      T.attHat = up;
      T.hatLift = 12 * up; T.hatRot = -8 - 16 * up; T.hatX = -3 * up;
      T.fy += 4 * bow; T.cry += 3 * bow; T.sqy -= 0.03 * bow; T.floatY -= 12 * hop;
      T.sqy += 0.05 * hop; T.sqx -= 0.03 * hop;
      T.happy = 1; T.smile = 1; T.blush = 0.95;
      T.lhx = lerp(122, 156, hop); T.lhy = lerp(142, 104, hop);   // little fist pump
      T.spark = win(ph, .22, .32, .55, .68);
      T.confT = ph;
      T.scr = 1; T.checkDraw = 1;                          // job done: the window shows a tick
    },
    error(T, tau, L) {
      const ph = phase(tau, 3.4);
      const w = win(ph, 0, .05, .26, .38);
      const fix = win(ph, .3, .42, .76, .88);
      const straight = smooth(.44, .8, ph);
      T.tieRot = 20 * (1 - straight) + 4 * Math.sin(tau * 20) * fix * (1 - straight);
      T.squint = w; T.eyeOpen = 0.85; T.mouthO = w;
      const worry = Math.max(w, 0.55);
      T.browL = -16 * worry; T.browR = 16 * worry; T.browLY = 1; T.browRY = 1;
      T.floatY += 5 * w; T.lean += 1.5 * Math.sin(tau * 42) * w; T.sqy -= 0.04 * w; T.sqx += 0.025 * w;
      T.earL = -12 * w; T.earR = 12 * w; T.fy += 2;
      T.sweat = Math.max(w, fix * 0.9); T.sweatY = ph * 8;
      T.monoDrop = 1 - smooth(.78, .95, ph);               // monocle pops, dangles, gets put back
      T.rhx = lerp(56, 91, fix); T.rhy = lerp(138, 131, fix);
      T.lhx = lerp(144, 109, fix); T.lhy = lerp(138, 131, fix);
    }
  };
  const STATIC_TAU = { idle: 0, listening: 2.6, thinking: 0, working: 0.6, teaching: 2 * TEACH_STEP + 1.1,
                       checking: 2.9, needs_approval: 0, success: 1.26, error: 2.04 };

  function rot([x, y], [cx, cy], deg) {
    const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG), dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }
  const crestToWorld = (p, P) => { const r = rot(p, CREST_PIVOT, P.crr); return [r[0] + P.crx, r[1] + P.cry]; };
  const hatToWorld = (p, P) => { const r = rot(p, HAT_PIVOT, P.hatRot); return crestToWorld([r[0] + P.hatX, r[1] + HAT_SEAT - P.hatLift], P); };

  /* ---------- Factory ---------- */
  let uid = 0;
  function create(container, opts = {}) {
    const u = 'b' + (++uid);
    let paletteName = PALETTES[opts.palette] ? opts.palette : 'holo';
    let svg, el;
    function build() {
      container.innerHTML = template(u, PALETTES[paletteName]);
      svg = container.querySelector('svg');
      el = {};
      svg.querySelectorAll('[data-p]').forEach((n) => { el[n.dataset.p] = n; });
    }
    build();

    const mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let rmSetting = opts.reducedMotion ?? 'auto';
    const reduced = () => (rmSetting === 'auto' ? !!(mq && mq.matches) : !!rmSetting);

    let state = STATES.includes(opts.state) ? opts.state : 'idle';
    let trackPointer = opts.trackPointer !== false;
    const hoverReact = opts.hoverReact !== false;
    let t = 0, last = performance.now(), stateStart = 0, popStart = -10, popAmp = 1, pokeStart = -10;
    let nextBlink = 1.5, blinkStart = -10;
    const P = Object.assign({}, REST);
    const look = { x: 0, y: 0 };
    let pointer = null, manual = null, lastMove = 0, raf = 0;
    let hovered = false, hover = 0;
    let jig = 0, jv = 0, prevLX = 0;           // jelly spring (degrees of skew)

    function gazeTarget() {
      const src = manual || pointer;
      if (!src) return { x: 0, y: 0 };
      if (!manual && performance.now() - lastMove > 6000) return { x: 0, y: 0 };
      const r = svg.getBoundingClientRect(), RANGE = 260;
      const soft = (v) => clamp(v / Math.sqrt(1 + v * v), -1, 1);
      return { x: soft((src.x - (r.left + r.width * 0.5)) / RANGE), y: soft((src.y - (r.top + r.height * 0.5)) / RANGE) };
    }

    function frame(now) {
      const dt = Math.max(1e-3, Math.min(0.05, (now - last) / 1000)); last = now; t += dt;
      const rm = reduced(), motion = rm ? 0 : 1;

      const g = gazeTarget(), gk = 1 - Math.exp(-dt * (rm ? 20 : 5));
      look.x += (g.x - look.x) * gk; look.y += (g.y - look.y) * gk;
      hover += ((hovered ? 1 : 0) - hover) * (1 - Math.exp(-dt * 8));

      // jelly: gaze velocity drives a damped spring, so quick mouse swipes make him wobble
      const vel = (look.x - prevLX) / dt; prevLX = look.x;
      if (rm) { jig = 0; jv = 0; }
      else {
        jv += (-140 * jig - 7 * jv - vel * (40 + 60 * hover)) * dt;
        jig = clamp(jig + jv * dt, -12, 12);
      }

      const T = Object.assign({}, REST);
      const fl = Math.sin(t * 2 * PI / 3.2) * motion;
      T.floatY = -5 + 5 * fl;
      T.sqy += 0.012 * Math.cos(t * 2 * PI / 3.2) * motion;
      T.rhy += 3 * Math.sin(t * 2 * PI / 3.2 - 0.7) * motion;
      T.lhy += 3 * Math.sin(t * 2 * PI / 3.2 - 1.3) * motion;
      T.fx += look.x * 6; T.fy += look.y * 4;
      T.crx += look.x * 2.5 * motion; T.cry += look.y * 1.5 * motion;
      T.crr += look.x * 3 * motion; T.lean += look.x * 3 * motion;
      POSES[state](T, rm ? STATIC_TAU[state] : t - stateStart, look);
      if (hoverReact) {
        T.floatY -= 7 * hover * motion; T.blush += 0.35 * hover; T.smile = Math.max(T.smile, hover);
        T.earL += 8 * hover; T.earR -= 8 * hover; T.rhy -= 4 * hover; T.lhy -= 4 * hover;
        if (state === 'idle') T.happy = Math.max(T.happy, hover);
      }
      // boop reaction: big blush, happy eyes for a moment
      const pk = clamp((t - pokeStart) / 1.2, 0, 1), boop = pk < 1 ? 1 - pk : 0;
      if (boop > 0) { T.happy = Math.max(T.happy, boop > .2 ? 1 : 0); T.blush = Math.max(T.blush, 1); T.smile = 1; T.earL += 12 * boop; T.earR -= 12 * boop; }
      if (rm) { T.shimmer = -1; T.sweatY = 0; T.tapY = 0; T.hatSpin = 0; }

      const k = 1 - Math.exp(-dt * (rm ? 30 : 9));
      for (const key in T) P[key] = UNSMOOTHED.has(key) ? T[key] : P[key] + (T[key] - P[key]) * k;

      if (!rm && t > nextBlink) { blinkStart = t; nextBlink = t + 2.4 + Math.random() * 3.6 + (Math.random() < .2 ? -2.2 : 0); }
      const bp = (t - blinkStart) / 0.16;
      const blink = bp >= 0 && bp <= 1 ? 1 - Math.abs(bp * 2 - 1) : 0;

      const ppk = clamp((t - popStart) / 0.6, 0, 1);
      const pop = ppk < 1 ? Math.sin(ppk * PI * 2.5) * (1 - ppk) * popAmp * motion : 0;

      render(blink, pop, rm, pk);
      raf = requestAnimationFrame(frame);
    }

    function render(blink, pop, rm, pk) {
      const set = (n, a, v) => el[n].setAttribute(a, v);
      set('float', 'transform', `translate(0 ${f(P.floatY)})`);
      set('lean', 'transform', `rotate(${f(P.lean)} 100 162)`);
      set('body', 'transform', `translate(100 162) skewX(${f(jig)}) scale(${f(1 + P.sqx + .05 * pop)} ${f(1 + P.sqy - .08 * pop)}) translate(-100 -162)`);
      const h = clamp(-P.floatY / 20, -0.3, 1);
      set('shadow', 'transform', `translate(100 196) scale(${f(1 - .28 * h)} ${f(1 - .2 * h)}) translate(-100 -196)`);
      set('shadow', 'opacity', f(.55 - .25 * h));

      set('crest', 'transform', `translate(${f(P.crx)} ${f(P.cry)}) rotate(${f(P.crr)} ${CREST_PIVOT[0]} ${CREST_PIVOT[1]})`);
      set('earL', 'transform', `rotate(${f(-18 + P.earL)} 82 92)`);
      set('earR', 'transform', `rotate(${f(18 + P.earR)} 118 92)`);
      set('hat', 'transform', `translate(${f(P.hatX)} ${f(HAT_SEAT - P.hatLift)}) rotate(${f(P.hatRot)} ${HAT_PIVOT[0]} ${HAT_PIVOT[1]}) rotate(${f(P.hatSpin)} ${HAT_PIVOT[0]} ${HAT_PIVOT[1] - 11})`);
      set('face', 'transform', `translate(${f(P.fx)} ${f(P.fy)})`);

      const closed = Math.max(P.happy, P.squint);
      const sy = Math.max(0.08, P.eyeOpen * (1 - blink) * (1 - closed));
      const eyeT = (cx) => `translate(${cx} 104) scale(1 ${f(sy)}) translate(${-cx} -104)`;
      set('eyeL', 'transform', eyeT(84)); set('eyeR', 'transform', eyeT(116));
      const eyeOp = f(clamp((1 - closed) * 2, 0, 1));
      set('eyeL', 'opacity', eyeOp); set('eyeR', 'opacity', eyeOp);
      set('happy', 'opacity', f(clamp(P.happy * 2 - 1, 0, 1)));
      set('squint', 'opacity', f(clamp(P.squint * 2 - 1, 0, 1)));
      const o = clamp(P.mouthO * 1.5 - .2, 0, 1);
      set('mouthO', 'opacity', f(o));
      set('smile', 'opacity', f(P.smile * (1 - o)));
      set('blushL', 'opacity', f(Math.min(1, P.blush))); set('blushR', 'opacity', f(Math.min(1, P.blush)));
      set('browL', 'transform', `translate(0 ${f(P.browLY)}) rotate(${f(P.browL)} 84 91)`);
      set('browR', 'transform', `translate(0 ${f(P.browRY)}) rotate(${f(P.browR)} 116 91)`);
      set('sweat', 'opacity', f(P.sweat));
      set('sweat', 'transform', `translate(0 ${f(P.sweatY)})`);
      set('tie', 'transform', `rotate(${f(P.tieRot)} ${TIE[0]} ${TIE[1]})`);

      // monocle: drops to hang on its chain, swinging
      const md = P.monoDrop, swing = rm ? 0 : Math.sin(t * 6) * 12 * md;
      set('monocle', 'transform', `translate(${f(-4 * md)} ${f(20 * md)}) rotate(${f(28 * md + swing)} 116 104)`);

      let rx = P.rhx, ry = P.rhy;
      const glue = (p, w) => { if (w > 0.001) { rx = lerp(rx, p[0], w); ry = lerp(ry, p[1], w); } };
      glue([ATTACH.chin[0] + P.fx, ATTACH.chin[1] + P.fy], P.attChin);
      glue(crestToWorld(ATTACH.ear, P), P.attEar);
      glue(hatToWorld(ATTACH.hatGrip, P), P.attHat);
      ry += P.tapY;
      set('gloveR', 'transform', `translate(${f(rx)} ${f(ry)})`);
      set('gloveL', 'transform', `translate(${f(P.lhx)} ${f(P.lhy)})`);
      set('napkin', 'transform', `translate(${f(P.lhx)} ${f(P.lhy + 5)})`);
      set('napkin', 'opacity', f(clamp(1 - 1.5 * Math.max(P.pad, P.baton, P.glass, P.lap), 0, 1)));

      const prop = (n, v, x, y, r = 0) => {
        set(n, 'opacity', f(clamp(v * 1.4 - .2, 0, 1)));
        set(n, 'transform', `translate(${f(x)} ${f(y)}) rotate(${f(r)}) scale(${f(0.6 + 0.4 * v)})`);
      };
      prop('trayC', P.trayC, rx, ry - 9);
      prop('trayK', P.trayK, rx, ry - 9);
      prop('glass', P.glass, P.lhx, P.lhy, P.glassRot);
      set('shimmer', 'x', f(P.shimmer < 0 ? -60 : -30 + P.shimmer * 60));

      /* --- work: laptop --- */
      const fade = (v) => f(clamp(v * 1.4 - .2, 0, 1));
      set('lap', 'opacity', fade(P.lap));
      set('lap', 'transform', `translate(168 ${f(166 - 6 * P.lap)}) scale(${f(.6 + .4 * P.lap)})`);
      set('code', 'transform', `translate(0 ${f(-((P.workT * 9) % 24))})`);
      set('prog', 'width', f(36 * smooth(0, .92, phase(P.workT, 4.5))));

      /* --- teach: app window, cursor, clicks, step dots --- */
      const sc = .6 + .4 * P.scr, sx = SCR[0], sy0 = SCR[1] - 6 * (1 - P.scr);
      set('scr', 'opacity', fade(P.scr));
      set('scr', 'transform', `translate(${sx} ${f(sy0)}) scale(${f(sc)})`);
      const toWorld = (p) => [sx + p[0] * sc, sy0 + p[1] * sc];
      let cur = null;
      if (P.teachT >= 0) {
        const n = Math.floor(P.teachT / TEACH_STEP), step = n % 3, uu = (P.teachT % TEACH_STEP) / TEACH_STEP;
        const from = BTN[(step + 2) % 3], to = BTN[step];
        const m = smooth(.05, .45, uu), arc = Math.sin(m * PI) * -8;
        cur = [lerp(from[0], to[0], m) + arc * .3 - 2, lerp(from[1], to[1], m) + arc];
        set('cursor', 'opacity', fade(P.scr));
        set('cursor', 'transform', `translate(${f(cur[0])} ${f(cur[1])}) scale(${f(1 - .15 * win(uu, .46, .5, .52, .58))})`);
        set('hilite', 'opacity', f(smooth(.4, .5, uu) * P.scr));
        set('hilite', 'y', f(to[1] - 4));
        const r = smooth(.5, .8, uu);
        set('ripple', 'opacity', f((1 - r) * (uu > .5 ? 1 : 0)));
        set('ripple', 'r', f(2 + 9 * r));
        set('ripple', 'transform', `translate(${to[0]} ${to[1]})`);
        for (let i = 0; i < 3; i++) {
          const done = i < step || (i === step && uu > .5);
          set('dot' + i, 'opacity', done ? '1' : '.28');
          set('dot' + i, 'r', i === step ? f(2 + .8 * win(uu, .5, .56, .6, .75)) : '2');
        }
      } else {
        set('cursor', 'opacity', '0'); set('hilite', 'opacity', '0'); set('ripple', 'opacity', '0');
      }
      set('dots', 'opacity', f(P.dotsOn * P.scr));
      set('check', 'opacity', f(P.scr * clamp(P.checkDraw * 4, 0, 1)));
      set('check', 'transform', `scale(${f(.6 + .4 * smooth(0, .5, P.checkDraw))})`);
      set('checkPath', 'stroke-dashoffset', f(20 * (1 - smooth(.25, 1, P.checkDraw))));

      // baton in the left glove, aimed at the cursor
      set('baton', 'opacity', fade(P.baton));
      const aim = cur ? toWorld([cur[0] - 2, cur[1] + 4]) : [P.lhx + 20, P.lhy - 40];
      const ang = Math.atan2(aim[1] - P.lhy, aim[0] - P.lhx) / DEG + 90;
      set('baton', 'transform', `translate(${f(P.lhx)} ${f(P.lhy)}) rotate(${f(ang)})`);

      /* --- listen: note pad --- */
      set('pad', 'opacity', fade(P.pad));
      set('pad', 'transform', `translate(${f(P.lhx - 2)} ${f(P.lhy - 3)}) rotate(-8) scale(${f(.6 + .4 * P.pad)})`);
      const pt = P.padT, W = [14, 11, 13];
      const ln = [smooth(0, .25, pt), smooth(.28, .52, pt), smooth(.55, .8, pt)];
      for (let i = 0; i < 3; i++) set('padL' + i, 'width', f(W[i] * ln[i]));
      const li = pt < .27 ? 0 : pt < .54 ? 1 : 2;
      const penOn = pt < .82;
      set('pencil', 'transform', `translate(${f(-7 + W[li] * ln[li] + (penOn ? 0 : 6))} ${f(-18.5 + 5 * li - (penOn ? 0 : 6))})`);

      const s = P.spark;
      set('spark1', 'opacity', f(s)); set('spark2', 'opacity', f(s));
      set('spark1', 'transform', `translate(134 ${f(18 - 6 * s)}) scale(${f(.4 + .7 * s)})`);
      set('spark2', 'transform', `translate(150 ${f(40 - 4 * s)}) scale(${f(.3 + .45 * s)})`);

      // thought bubbles pulse in sequence
      for (let i = 0; i < 3; i++) {
        const beat = rm ? 1 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 3 - i * 0.9));
        set('think' + i, 'opacity', f(P.think * beat));
        set('think' + i, 'transform', `translate(${f(P.fx * .5)} ${f(P.floatY + (rm ? 0 : -1.5 * Math.sin(t * 2 + i)))})`);
      }

      // confetti burst on success (fountain from the hat, with gravity + spin)
      const ct = P.confT, cu = ct < 0 || rm ? -1 : (ct - .2) / .55;
      for (let i = 0; i < 6; i++) {
        if (cu < 0 || cu > 1) { set('conf' + i, 'opacity', '0'); continue; }
        const a = (-150 + i * 24) * DEG, sp = 70 + (i % 3) * 14;
        const x = 100 + Math.cos(a) * sp * cu, y = 40 + P.floatY + Math.sin(a) * sp * cu + 90 * cu * cu;
        set('conf' + i, 'opacity', f(1 - smooth(.7, 1, cu)));
        set('conf' + i, 'transform', `translate(${f(x)} ${f(y)}) rotate(${f(cu * 540 * (i % 2 ? 1 : -1))}) scale(1 ${f(.5 + .5 * Math.abs(Math.cos(cu * 12 + i)))})`);
      }

      // boop hearts
      for (let i = 0; i < 3; i++) {
        const hp = pk - i * 0.08;
        if (rm || hp <= 0 || hp >= 1) { set('heart' + i, 'opacity', '0'); continue; }
        const x = 100 + (i - 1) * 26 + Math.sin(hp * 7 + i) * 4, y = 64 + P.floatY - hp * 56;
        set('heart' + i, 'opacity', f(1 - smooth(.55, 1, hp)));
        set('heart' + i, 'transform', `translate(${f(x)} ${f(y)}) rotate(${f((i - 1) * 14)}) scale(${f(.6 + 1.1 * Math.sin(Math.min(1, hp * 2) * PI / 2))})`);
      }
    }

    /* ---------- Input ---------- */
    const inBody = (e) => {
      const r = svg.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width * 0.36);
      const dy = (e.clientY - (r.top + r.height * 0.5)) / (r.height * 0.42);
      return dx * dx + dy * dy < 1;
    };
    const onMove = (e) => {
      if (trackPointer) { pointer = { x: e.clientX, y: e.clientY }; lastMove = performance.now(); }
      if (hoverReact) {
        const inside = inBody(e);
        if (inside && !hovered) { popStart = t; popAmp = 1; }
        hovered = inside;
      }
    };
    const onDown = (e) => { if (inBody(e)) api.poke(); };
    const onLeave = (e) => { if (!e.relatedTarget) { pointer = null; hovered = false; } };
    global.addEventListener('pointermove', onMove, { passive: true });
    global.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerout', onLeave);

    /* ---------- Public API ---------- */
    const api = {
      setState(name) {
        if (!STATES.includes(name)) { console.warn('[Butler] unknown state:', name); return; }
        if (name === state) return;
        const prev = state;
        state = name; stateStart = t; popStart = t; popAmp = 1;
        if (!reduced()) { blinkStart = t; nextBlink = t + 2 + Math.random() * 2; }
        container.dispatchEvent(new CustomEvent('butler:state', { detail: { state, prev } }));
      },
      getState: () => state,
      poke() {
        popStart = t; popAmp = 2.2; pokeStart = t;
        if (!reduced()) jv += (Math.random() < .5 ? -1 : 1) * 90;
        container.dispatchEvent(new CustomEvent('butler:poke'));
      },
      setPalette(name) { if (PALETTES[name] && name !== paletteName) { paletteName = name; build(); } },
      getPalette: () => paletteName,
      lookAt(x, y) { manual = x == null ? null : { x, y }; },
      setTrackPointer(on) { trackPointer = !!on; if (!on) pointer = null; },
      setReducedMotion(v) { rmSetting = v; },
      destroy() {
        cancelAnimationFrame(raf);
        global.removeEventListener('pointermove', onMove);
        global.removeEventListener('pointerdown', onDown);
        document.removeEventListener('pointerout', onLeave);
        container.innerHTML = '';
      }
    };
    raf = requestAnimationFrame(frame);
    return api;
  }

  global.Butler = {
    create, STATES,
    PALETTES: Object.keys(PALETTES),
    paletteInfo: (n) => PALETTES[n] && { label: PALETTES[n].label, color: PALETTES[n].b1, color2: PALETTES[n].c0, color3: PALETTES[n].iri2 }
  };
})(window);

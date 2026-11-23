// Realistic resistor as layered SVG: shaded ceramic body with grain, glossy
// printed bands clipped to the body, metallic leads. Shared gradients and
// filters live once in index.html (#resistor-defs), so each render is just a
// few cheap elements.
import { COLOR, breakdown } from './core.js';

const BODY = 'M96 33C80 33 75 45 75 60C75 75 80 87 96 87C109 87 112 80 123 80L237 80C248 80 251 87 264 87' +
  'C280 87 285 75 285 60C285 45 280 33 264 33C251 33 248 40 237 40L123 40C112 40 109 33 96 33Z';

const POS = {
  4: [101, 133, 163, 247],
  5: [98, 127, 151, 175, 247],
};
const BAND_W = 13;

const fill = (id) => (id === 'gold' ? 'url(#g-gold)' : id === 'silver' ? 'url(#g-silver)' : COLOR[id].hex);

export function resistorSVG(r, { reveal = false, codes = false } = {}) {
  const xs = POS[r.bandCount];
  const info = breakdown(r).items;
  const bands = r.bands.map((id, i) => {
    const x = xs[i];
    // Ink sits slightly inside the body edge and carries a soft dark rim, like printed paint.
    return `<rect x="${x}" y="28" width="${BAND_W}" height="64" fill="${fill(id)}"/>` +
      `<rect x="${x}" y="28" width="${BAND_W}" height="64" fill="url(#g-bandrim)"/>`;
  }).join('');

  const codesTxt = codes ? r.bands.map((id, i) =>
    `<text x="${xs[i] + BAND_W / 2}" y="22" class="rz-code">${COLOR[id].code}</text>`).join('') : '';

  const labels = reveal ? r.bands.map((id, i) =>
    `<line x1="${xs[i] + BAND_W / 2}" y1="91" x2="${xs[i] + BAND_W / 2}" y2="99" class="rz-tick"/>` +
    `<text x="${xs[i] + BAND_W / 2}" y="113" class="rz-label">${info[i].text}</text>`).join('') : '';

  const names = r.bands.map((id) => COLOR[id].name).join(', ');
  return `<svg viewBox="34 10 292 108" class="rz" role="img" aria-label="Resistor with ${r.bandCount} bands: ${names}">
  <g class="rz-leads">
    <rect x="0" y="57" width="84" height="6" rx="3" fill="url(#g-lead)"/>
    <rect x="276" y="57" width="84" height="6" rx="3" fill="url(#g-lead)"/>
    <rect x="70" y="55.5" width="10" height="9" rx="2" fill="url(#g-lead-dark)"/>
    <rect x="280" y="55.5" width="10" height="9" rx="2" fill="url(#g-lead-dark)"/>
  </g>
  <g clip-path="url(#c-body)">
    <rect x="70" y="28" width="220" height="64" fill="url(#g-body)"/>
    <rect x="70" y="28" width="220" height="64" filter="url(#f-grain)" opacity=".22"/>
    ${bands}
    <rect x="70" y="28" width="220" height="64" fill="url(#g-shade)"/>
    <rect x="70" y="28" width="220" height="64" fill="url(#g-ends)"/>
    <rect x="70" y="41" width="220" height="5" fill="url(#g-spec)" opacity=".75"/>
  </g>
  <path d="${BODY}" fill="none" stroke="rgba(40,26,10,.35)" stroke-width="1"/>
  ${codesTxt}${labels}
</svg>`;
}

/** Hidden <svg> of shared defs; injected once at startup. */
export const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
<defs>
  <clipPath id="c-body"><path d="${BODY}"/></clipPath>
  <linearGradient id="g-body" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#8a6e47"/><stop offset=".18" stop-color="#d9c194"/>
    <stop offset=".34" stop-color="#f1e1bd"/><stop offset=".55" stop-color="#d7bd8c"/>
    <stop offset=".85" stop-color="#9f8257"/><stop offset="1" stop-color="#6c5434"/>
  </linearGradient>
  <linearGradient id="g-shade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#000" stop-opacity=".35"/>
    <stop offset=".2" stop-color="#fff" stop-opacity=".08"/>
    <stop offset=".3" stop-color="#fff" stop-opacity=".34"/>
    <stop offset=".42" stop-color="#fff" stop-opacity=".04"/>
    <stop offset=".7" stop-color="#000" stop-opacity=".12"/>
    <stop offset="1" stop-color="#000" stop-opacity=".55"/>
  </linearGradient>
  <linearGradient id="g-ends" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".06" stop-color="#000" stop-opacity="0"/>
    <stop offset=".94" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/>
  </linearGradient>
  <linearGradient id="g-spec" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".25" stop-color="#fff" stop-opacity=".7"/>
    <stop offset=".6" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="g-bandrim" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".18" stop-color="#000" stop-opacity="0"/>
    <stop offset=".5" stop-color="#fff" stop-opacity=".1"/>
    <stop offset=".82" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/>
  </linearGradient>
  <linearGradient id="g-lead" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5f6569"/><stop offset=".35" stop-color="#eef2f4"/>
    <stop offset=".6" stop-color="#a3a9ad"/><stop offset="1" stop-color="#454a4e"/>
  </linearGradient>
  <linearGradient id="g-lead-dark" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4a4f52"/><stop offset=".4" stop-color="#b8bec2"/><stop offset="1" stop-color="#33373a"/>
  </linearGradient>
  <linearGradient id="g-gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6e5212"/><stop offset=".3" stop-color="#f6e08f"/>
    <stop offset=".55" stop-color="#c9a13b"/><stop offset="1" stop-color="#5f460f"/>
  </linearGradient>
  <linearGradient id="g-silver" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5b5f63"/><stop offset=".3" stop-color="#f5f7f9"/>
    <stop offset=".55" stop-color="#b6b9bd"/><stop offset="1" stop-color="#4b4f52"/>
  </linearGradient>
  <filter id="f-grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="7" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 .25  0 0 0 0 .17  0 0 0 0 .08  0 0 0 1.6 -.55"/>
    <feComposite in2="SourceGraphic" operator="in"/>
  </filter>
</defs></svg>`;

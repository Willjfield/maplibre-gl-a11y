import maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.4.0/+esm';
import { installMapLibreA11y } from '../dist/maplibre-gl-a11y.esm.js';
import { Protocol } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.4.1/+esm';

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

installMapLibreA11y(maplibregl);

const IMD_LAYER_ID = 'glasgow-2011-imd-fill';
const A11Y_CONTROL_BUTTON_SEL = '.maplibre-gl-a11y-control-button';

const map = new maplibregl.Map({
  container: 'map',
  style: './style.json',
  center: [-4.2499, 55.8574],
  zoom: 11,
  hash: true
});

/**
 * Parse fill-color when it is a ["match", input, decile, color, ..., default] expression.
 * @param {unknown} expr
 * @returns {{ stops: { decile: number; color: string }[]; defaultColor: string } | null}
 */
function parseImdDecileMatchExpression(expr) {
  if (!Array.isArray(expr) || expr[0] !== 'match') {
    return null;
  }
  const stops = [];
  for (let i = 2; i < expr.length - 1; i += 2) {
    const decile = expr[i];
    const color = expr[i + 1];
    if (typeof decile === 'number' && typeof color === 'string') {
      stops.push({ decile, color });
    }
  }
  const defaultColor = expr[expr.length - 1];
  if (typeof defaultColor !== 'string') {
    return null;
  }
  return { stops, defaultColor };
}

function resolveColorForSwatch(cssColor) {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;background-color:transparent';
  document.body.appendChild(probe);
  probe.style.backgroundColor = cssColor;
  const resolved = getComputedStyle(probe).backgroundColor;
  document.body.removeChild(probe);
  if (!resolved || resolved === 'rgba(0, 0, 0, 0)' || resolved === 'transparent') {
    return '#999999';
  }
  return resolved;
}

function describeStyleVariant(defaultColor) {
  const d = typeof defaultColor === 'string' ? defaultColor.trim().toLowerCase() : '';
  if (d === '#cccccc') {
    return 'Accessible style palette (higher contrast).';
  }
  if (d === '#000000') {
    return 'Default style palette.';
  }
  return 'Current map style palette.';
}

function updateImdLegend() {
  const root = document.getElementById('imd-legend');
  const swatchesEl = document.getElementById('imd-legend-swatches');
  const schemeNoteEl = document.getElementById('imd-legend-scheme-note');
  if (!root || !swatchesEl || !schemeNoteEl) {
    return;
  }
  if (!map.getLayer(IMD_LAYER_ID)) {
    root.hidden = true;
    return;
  }
  root.hidden = false;

  const expr = map.getPaintProperty(IMD_LAYER_ID, 'fill-color');
  const parsed = parseImdDecileMatchExpression(expr);
  if (!parsed || parsed.stops.length === 0) {
    schemeNoteEl.textContent = 'Could not read decile colors from the current style.';
    swatchesEl.replaceChildren();
    return;
  }

  schemeNoteEl.textContent = describeStyleVariant(parsed.defaultColor);

  const ordered = [...parsed.stops].sort((a, b) => a.decile - b.decile);
  swatchesEl.replaceChildren();
  for (const { decile, color } of ordered) {
    const item = document.createElement('li');
    item.className = 'imd-legend-item';
    item.title = `Decile ${decile}`;

    const sw = document.createElement('span');
    sw.className = 'imd-legend-swatch';
    sw.style.backgroundColor = resolveColorForSwatch(color);
    sw.setAttribute('aria-hidden', 'true');

    const lab = document.createElement('span');
    lab.className = 'imd-legend-decile-label';
    lab.textContent = String(decile);

    item.appendChild(sw);
    item.appendChild(lab);
    swatchesEl.appendChild(item);
  }
}

function scheduleLegendUpdate() {
  if (!map.isStyleLoaded()) {
    map.once('idle', () => updateImdLegend());
    return;
  }
  window.requestAnimationFrame(() => updateImdLegend());
}

function setupImdLegend() {
  map.on('styledata', (e) => {
    //console.log('styledata', e);
    //if (e.dataType === 'style') {
      scheduleLegendUpdate();
    //}
  });
}

function setupA11yDiscoveryCallout() {
  const CALL_MS = 5000;
  let timeoutId;
  let calloutEl;
  let resizeHandler;
  let anchorButton;

  function removeCallout() {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = undefined;
    }
    anchorButton = undefined;
    if (calloutEl && calloutEl.parentNode) {
      calloutEl.parentNode.removeChild(calloutEl);
    }
    calloutEl = undefined;
  }

  function cancelTimer() {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  }

  function positionCallout() {
    if (!calloutEl || !anchorButton) {
      return;
    }
    const r = anchorButton.getBoundingClientRect();
    const gap = 10;
    calloutEl.style.top = `${r.bottom + gap}px`;
    calloutEl.style.left = `${Math.max(8, r.left + r.width / 2 - calloutEl.offsetWidth / 2)}px`;
  }

  function showCallout(anchor) {
    if (calloutEl) {
      return;
    }
    anchorButton = anchor;
    calloutEl = document.createElement('div');
    calloutEl.id = 'a11y-demo-callout';
    calloutEl.className = 'a11y-demo-callout';
    calloutEl.setAttribute('role', 'status');
    calloutEl.innerHTML =
      '<p class="a11y-demo-callout-title">Accessibility tools</p>' +
      '<p class="a11y-demo-callout-body">Use the map control above this message for grid navigation, a higher-contrast style, and audio exploration.</p>';

    document.body.appendChild(calloutEl);
    positionCallout();
    resizeHandler = () => positionCallout();
    window.addEventListener('resize', resizeHandler);

    const live = document.getElementById('a11y-demo-callout-live');
    if (live) {
      live.textContent = '';
      window.requestAnimationFrame(() => {
        live.textContent =
          'Accessibility options are available from the accessibility button on the map.';
      });
    }
  }

  function arm() {
    const btn = document.querySelector(A11Y_CONTROL_BUTTON_SEL);
    if (!btn) {
      return;
    }

    const dismiss = () => {
      cancelTimer();
      removeCallout();
    };

    const onNoticed = () => dismiss();
    btn.addEventListener('focus', onNoticed, { once: true, capture: true });
    btn.addEventListener('pointerdown', onNoticed, { once: true, capture: true });

    timeoutId = window.setTimeout(() => {
      timeoutId = undefined;
      if (document.activeElement === btn || btn.getAttribute('aria-expanded') === 'true') {
        return;
      }
      showCallout(btn);
    }, CALL_MS);
  }

  window.requestAnimationFrame(arm);
}

map.on('load', () => {
  map.addAccessability({
    accessibleStyle: 'a11y_style.json',
    layers: ['glasgow-2011-imd-fill'],
    layerAliases: {
      'glasgow-2011-imd-fill': 'Glasgow 2011 IMD'
    },
    layerProperties: {
      'glasgow-2011-imd-fill': ['Neighborhood_Name', 'uk_imd2019_SOA_decile']
    },
    propertyAliases: {
      Neighborhood_Name: 'Neighborhood',
      uk_imd2019_SOA_decile: 'IMD Decile'
    }
  });

  setupImdLegend();
  scheduleLegendUpdate();
  setupA11yDiscoveryCallout();
});

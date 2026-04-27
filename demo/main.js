import maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.4.0/+esm';
import { installMapLibreA11y } from '../dist/maplibre-gl-a11y.esm.js';

installMapLibreA11y(maplibregl);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [0, 20],
  zoom: 2
});

map.on('load', () => {
  map.addAccessability();
});

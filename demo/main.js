import maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.4.0/+esm';
import { installMapLibreA11y } from '../dist/maplibre-gl-a11y.esm.js';
import { Protocol } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.4.1/+esm';
import { setupImdLegend, scheduleLegendUpdate, setupA11yDiscoveryCallout } from './demo_helpers.js';
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

installMapLibreA11y(maplibregl);

const map = new maplibregl.Map({
  container: 'map',
  style: './style.json',
  center: [-4.2499, 55.8574],
  zoom: 11,
  hash: true
});


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

  const githubLink = document.createElement('a');
  githubLink.href = 'https://github.com/Willjfield/maplibre-gl-a11y';
  githubLink.target = '_blank';
  githubLink.rel = 'noopener noreferrer';
  githubLink.innerHTML = 'https://github.com/Willjfield/maplibre-gl-a11y';
  githubLink.className = 'maplibregl-ctrl-top-right-link';
  document.getElementsByClassName('maplibregl-ctrl-top-right')[0].appendChild(githubLink);

  setupImdLegend(map);
  scheduleLegendUpdate(map);
  setupA11yDiscoveryCallout(map);
});

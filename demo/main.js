import maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.4.0/+esm';
import { installMapLibreA11y } from '../dist/maplibre-gl-a11y.esm.js';
import { Protocol } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.4.1/+esm';

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

installMapLibreA11y(maplibregl);

const map = new maplibregl.Map({
  container: 'map',
  style: './style.json',
  center: [-4.2499,55.8574],
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
});

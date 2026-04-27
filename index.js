import createControl from './createControl.js';

const DEFAULT_PLACEMENT = 'top-left';
const mapControlState = new WeakMap();

/**
 * Adds the accessibility control to the map.
 *
 * Intentionally uses the requested spelling for now.
 */
export function addAccessability(options = {}) {
  const placement = options.placement || DEFAULT_PLACEMENT;
  const controlOptions = { ...options };
  delete controlOptions.placement;
  const existingControl = mapControlState.get(this);
  if (existingControl) {
    this.removeControl(existingControl);
  }

  const control = createControl(this, controlOptions);
  this.addControl(control, placement);
  mapControlState.set(this, control);
}

/**
 * Removes the accessibility control from the map.
 */
export function hideAccessibility() {
  const existingControl = mapControlState.get(this);
  if (!existingControl) {
    return;
  }

  this.removeControl(existingControl);
  mapControlState.delete(this);
}

/**
 * Installs plugin methods onto maplibre-gl-js Map instances.
 * Usage:
 *   import maplibregl from 'maplibre-gl';
 *   import { installMapLibreA11y } from 'maplibre-gl-a11y';
 *   installMapLibreA11y(maplibregl);
 *   map.addAccessability();
 */
export function installMapLibreA11y(maplibregl) {
  if (!maplibregl || !maplibregl.Map || !maplibregl.Map.prototype) {
    throw new Error('installMapLibreA11y requires maplibregl with a Map class');
  }

  maplibregl.Map.prototype.addAccessability = addAccessability;
  maplibregl.Map.prototype.hideAccessibility = hideAccessibility;
}

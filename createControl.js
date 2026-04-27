const ICON_PATH_D =
  'M600,0C268.629,0,0,268.629,0,600s268.629,600,600,600s600-268.629,600-600S931.371,0,600,0z M600,80.167c287.105,0,519.833,232.727,519.833,519.833c0,287.105-232.727,519.871-519.833,519.871c-287.106,0-519.871-232.765-519.871-519.871S312.894,80.167,600,80.167z M922.375,541.163c17.269,16.33,16.732,39.747,3.838,56.29c-15.771,16.638-40.629,17.347-56.29,3.838c-48.914-44.386-102.442-85.918-152.237-131.77c-0.152,1.96-13.502-8.813-19.189-8.956c-5.118,0-7.677,5.971-7.677,17.91c2.512,49.275-1.148,101.299,4.478,149.04c2.133,17.484,3.198,27.506,3.198,30.064l57.569,327.505c3.299,30.075-13.141,52.539-39.658,57.569c-26.557,7.224-53.846-15.676-57.569-39.658c0,0-46.445-264.445-47.335-268.657s-2.46-27.537-11.514-28.784c-11.634,4.222-10.286,23.812-11.516,28.784c-1.229,4.972-47.335,268.657-47.335,268.657c-7.78,27.743-31.696,44.14-57.568,39.658c-29.562-7.392-44.012-31.018-39.658-57.569l57.569-328.784c8.5-60.769,6.396-115.129,6.396-176.546c0-11.944-2.345-18.128-7.036-18.55c-4.69-0.427-10.874,2.771-18.55,9.595L330.051,601.29c-17.788,13.255-42.655,11.046-56.29-3.838c-13.784-19.696-12.902-41.007,3.838-56.29l199.573-176.546c9.384-5.972,18.126-10.021,26.228-12.154c8.104-2.132,18.125-3.198,30.062-3.198h133.05c11.939,0,21.962,1.066,30.063,3.198c8.103,2.133,16.845,6.61,26.227,13.433C786.344,421.632,853.806,481.598,922.375,541.163L922.375,541.163z M688.031,238.326c0,48.328-39.178,87.505-87.504,87.505c-48.328,0-87.506-39.177-87.506-87.505c0-48.327,39.178-87.504,87.506-87.504C648.854,150.821,688.031,189.999,688.031,238.326z';

const DEFAULT_CELL_SIZE = 48;

function getFeatureLabel(feature) {
  if (!feature || !feature.properties) {
    return 'Unnamed feature';
  }

  return (
    feature.properties.name ||
    feature.properties.title ||
    feature.properties.class ||
    feature.properties.type ||
    `Feature ${feature.id ?? 'unknown'}`
  );
}

function ensureControlStyles() {
    if (document.getElementById('maplibre-gl-a11y-control-styles')) {
      return;
    }
  
    const stylesheetLink = document.createElement('link');
    stylesheetLink.id = 'maplibre-gl-a11y-control-styles';
    stylesheetLink.rel = 'stylesheet';
    stylesheetLink.href = new URL('./maplibre-gl-a11y.css', import.meta.url).href;
    document.head.appendChild(stylesheetLink);
  }
  
export default function createControl(map, options = {}) {
  const cellSize = Math.max(8, Number(options.cellSize) || DEFAULT_CELL_SIZE);
  const targetLayers = Array.isArray(options.layers) ? options.layers : [];
  const showGridBorder = options.showGridBorder !== false;
  const borderColor = options.borderColor || 'rgba(56, 135, 190, 0.6)';
  const borderWidth = Number.isFinite(options.borderWidth) ? options.borderWidth : 1;

  let controlContainer;
  let controlButton;
  let overlayContainer;
  let idleHandler;
  let resizeHandler;
  let isGridVisible = false;

  function updateCellAccessibility(cell, features) {
    const listElement = cell.listElement;
    listElement.innerHTML = '';

    const dedupe = new Set();
    const uniqueFeatures = [];
    for (const feature of features) {
      const key = `${feature.layer?.id ?? 'unknown'}:${feature.source ?? 'source'}:${feature.id ?? JSON.stringify(feature.properties)}`;
      if (!dedupe.has(key)) {
        dedupe.add(key);
        uniqueFeatures.push(feature);
      }
    }

    for (const feature of uniqueFeatures) {
      const item = document.createElement('li');
      const layerName = feature.layer?.id || 'unknown-layer';
      item.textContent = `${layerName}: ${getFeatureLabel(feature)}`;
      listElement.appendChild(item);
    }

    const featureCount = uniqueFeatures.length;
    cell.element.setAttribute(
      'aria-label',
      `Grid cell row ${cell.row + 1}, column ${cell.col + 1}. ${featureCount} feature${featureCount === 1 ? '' : 's'} in configured layers.`
    );
  }

  function populateGridFeatures(cells) {
    for (const cell of cells) {
      const queryOptions = targetLayers.length > 0 ? { layers: targetLayers } : 'countries';
      const features = map.queryRenderedFeatures(cell.bbox, queryOptions);
      updateCellAccessibility(cell, features);
    }
  }

  function buildGridOverlay() {
    if (!overlayContainer) {
      return;
    }

    overlayContainer.innerHTML = '';

    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const columns = Math.max(1, Math.ceil(width / cellSize));
    const rows = Math.max(1, Math.ceil(height / cellSize));
    const cells = [];

    overlayContainer.style.gridTemplateColumns = `repeat(${columns}, ${cellSize}px)`;
    overlayContainer.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const x1 = col * cellSize;
        const y1 = row * cellSize;
        const x2 = Math.min((col + 1) * cellSize, width);
        const y2 = Math.min((row + 1) * cellSize, height);

        const cellElement = document.createElement('div');
        cellElement.className = 'maplibre-gl-a11y-grid-cell';
        cellElement.tabIndex = 0;
        cellElement.setAttribute('role', 'region');
        cellElement.setAttribute('aria-live', 'polite');
        cellElement.style.width = `${x2 - x1}px`;
        cellElement.style.height = `${y2 - y1}px`;
        cellElement.style.border = showGridBorder ? `${borderWidth}px solid ${borderColor}` : '0';

        const listElement = document.createElement('ul');
        listElement.className = 'maplibre-gl-a11y-sr-list';
        cellElement.appendChild(listElement);

        overlayContainer.appendChild(cellElement);
        cells.push({
          row,
          col,
          element: cellElement,
          listElement,
          bbox: [
            [x1, y1],
            [x2, y2]
          ]
        });
      }
    }

    populateGridFeatures(cells);

    idleHandler = () => {
      populateGridFeatures(cells);
    };

    resizeHandler = () => {
      buildGridOverlay();
    };

    map.on('idle', idleHandler);
    map.on('resize', resizeHandler);
  }

  function destroyGridOverlay() {
    if (idleHandler) {
      map.off('idle', idleHandler);
      idleHandler = undefined;
    }
    if (resizeHandler) {
      map.off('resize', resizeHandler);
      resizeHandler = undefined;
    }

    if (overlayContainer && overlayContainer.parentNode) {
      overlayContainer.parentNode.removeChild(overlayContainer);
    }
    overlayContainer = undefined;
    isGridVisible = false;
    if (controlButton) {
      controlButton.setAttribute('aria-pressed', 'false');
    }
  }

  function toggleGridOverlay() {
    if (isGridVisible) {
      destroyGridOverlay();
      return;
    }

    overlayContainer = document.createElement('div');
    overlayContainer.className = 'maplibre-gl-a11y-grid-overlay';
    overlayContainer.setAttribute('aria-label', 'Accessibility grid overlay');
    map.getCanvasContainer().appendChild(overlayContainer);
    isGridVisible = true;
    controlButton.setAttribute('aria-pressed', 'true');
    buildGridOverlay();
  }

  return {
    onAdd() {
      ensureControlStyles();

      controlContainer = document.createElement('div');
      controlContainer.className = 'maplibregl-ctrl maplibregl-ctrl-group maplibre-gl-a11y-control';

      controlButton = document.createElement('button');
      controlButton.type = 'button';
      controlButton.className = 'maplibre-gl-a11y-control-button';
      controlButton.setAttribute('aria-label', 'Toggle accessibility feature grid');
      controlButton.setAttribute('aria-pressed', 'false');
      controlButton.title = 'Toggle accessibility feature grid';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 1200 1200');
      svg.setAttribute('aria-hidden', 'true');

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', ICON_PATH_D);
      svg.appendChild(path);

      controlButton.appendChild(svg);
      controlButton.addEventListener('click', toggleGridOverlay);

      controlContainer.appendChild(controlButton);
      return controlContainer;
    },
    onRemove() {
      destroyGridOverlay();
      if (controlButton) {
        controlButton.removeEventListener('click', toggleGridOverlay);
      }
      if (controlContainer && controlContainer.parentNode) {
        controlContainer.parentNode.removeChild(controlContainer);
      }
      controlContainer = undefined;
      controlButton = undefined;
    }
  };
}
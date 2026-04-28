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

function normalizeLayerConfig(options) {
  const layerProperties = {};
  const targetLayers = [];

  if (Array.isArray(options.layers)) {
    for (const layerItem of options.layers) {
      if (typeof layerItem === 'string') {
        targetLayers.push(layerItem);
        continue;
      }

      if (!layerItem || typeof layerItem !== 'object') {
        continue;
      }

      const layerId = layerItem.id || layerItem.layer;
      if (typeof layerId !== 'string') {
        continue;
      }

      targetLayers.push(layerId);
      if (Array.isArray(layerItem.properties) && layerItem.properties.length > 0) {
        layerProperties[layerId] = layerItem.properties.map(String);
      }
    }
  }

  if (options.layerProperties && typeof options.layerProperties === 'object') {
    for (const [layerId, properties] of Object.entries(options.layerProperties)) {
      if (!targetLayers.includes(layerId)) {
        targetLayers.push(layerId);
      }
      if (Array.isArray(properties) && properties.length > 0) {
        layerProperties[layerId] = properties.map(String);
      }
    }
  }

  return {
    targetLayers,
    layerProperties
  };
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
  const { targetLayers, layerProperties } = normalizeLayerConfig(options);
  const showGridBorder = options.showGridBorder !== false;
  const borderColor = options.borderColor || 'rgba(56, 135, 190, 0.6)';
  const borderWidth = Number.isFinite(options.borderWidth) ? options.borderWidth : 1;

  let controlContainer;
  let controlButton;
  let overlayContainer;
  let idleHandler;
  let resizeHandler;
  let isGridVisible = false;
  let cells = [];
  let gridColumns = 0;
  let gridRows = 0;
  let keyboardHelpElement;
  let keyboardHelpElementId;
  let srAnnouncementElement;
  let reenableNativeKeyboard = false;

  function announceKeyboardHelp() {
    if (!srAnnouncementElement) {
      return;
    }

    srAnnouncementElement.textContent = '';
    window.requestAnimationFrame(() => {
      srAnnouncementElement.textContent =
        'Accessibility grid active. Keyboard help: Arrow keys move cells and pan map at edges. Home and End jump row start and end. Press C to center map on selected cell. Press Z to zoom in, Shift Z to zoom out. Press H to hear this help again. Press Escape to return to the accessibility button.';
    });
  }

  function dedupeFeatures(features) {
    const dedupe = new Set();
    const uniqueFeatures = [];
    for (const feature of features) {
      const key = `${feature.layer?.id ?? 'unknown'}:${feature.source ?? 'source'}:${feature.id ?? JSON.stringify(feature.properties)}`;
      if (!dedupe.has(key)) {
        dedupe.add(key);
        uniqueFeatures.push(feature);
      }
    }
    return uniqueFeatures;
  }

  function getFeaturePropertiesForLayer(feature) {
    const layerId = feature.layer?.id || '';
    const configuredProperties = layerProperties[layerId];
    if (Array.isArray(configuredProperties) && configuredProperties.length > 0) {
      const filtered = {};
      for (const propertyName of configuredProperties) {
        if (Object.prototype.hasOwnProperty.call(feature.properties || {}, propertyName)) {
          filtered[propertyName] = feature.properties[propertyName];
        }
      }
      return filtered;
    }
    return feature.properties || {};
  }

  function buildFeatureSummary(feature) {
    const properties = getFeaturePropertiesForLayer(feature);
    const propertyEntries = Object.entries(properties);

    if (propertyEntries.length === 0) {
      return getFeatureLabel(feature);
    }

    return propertyEntries.map(([key, value]) => `${key}:${String(value)}`).join(', ');
  }

  function buildCellAriaLabel(cell) {
    if (!Array.isArray(cell.features) || cell.features.length === 0) {
      return `row ${cell.row + 1} column ${cell.col + 1}: no features`;
    }

    const layerSummaries = {};
    for (const feature of cell.features) {
      const layerName = feature.layer?.id || 'unknown-layer';
      if (!layerSummaries[layerName]) {
        layerSummaries[layerName] = [];
      }
      layerSummaries[layerName].push(buildFeatureSummary(feature));
    }

    const layerText = Object.entries(layerSummaries)
      .map(([layerName, summaries]) => `${layerName}: ${summaries.join(', ')}`)
      .join('; ');

    return `row ${cell.row + 1} column ${cell.col + 1}: ${layerText}`;
  }

  function renderCellFeatureList(cell) {
    if (!cell.listHeading || !cell.listElement) {
      return;
    }

    const listElement = cell.listElement;
    listElement.innerHTML = '';

    const featureCount = cell.features.length;
    cell.listHeading.textContent = `Cell r${cell.row + 1} c${cell.col + 1} (${featureCount} feature${featureCount === 1 ? '' : 's'})`;

    if (featureCount === 0) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'maplibre-gl-a11y-feature-item';
      emptyItem.textContent = 'No features in this cell.';
      listElement.appendChild(emptyItem);
      return;
    }

    for (const feature of cell.features) {
      const item = document.createElement('li');
      item.className = 'maplibre-gl-a11y-feature-item';
      const layerName = feature.layer?.id || 'unknown-layer';
      const title = document.createElement('div');
      title.className = 'maplibre-gl-a11y-feature-title';
      title.textContent = `${layerName}: ${getFeatureLabel(feature)}`;
      item.appendChild(title);

      const properties = getFeaturePropertiesForLayer(feature);
      const propertyEntries = Object.entries(properties);
      if (propertyEntries.length > 0) {
        const propertyList = document.createElement('ul');
        propertyList.className = 'maplibre-gl-a11y-property-list';
        for (const [key, value] of propertyEntries) {
          const propItem = document.createElement('li');
          propItem.textContent = `${key}: ${String(value)}`;
          propertyList.appendChild(propItem);
        }
        item.appendChild(propertyList);
      }

      listElement.appendChild(item);
    }
  }

  function updateCellAccessibility(cell, features) {
    const uniqueFeatures = dedupeFeatures(features);
    cell.features = uniqueFeatures;
    cell.element.setAttribute('aria-label', buildCellAriaLabel(cell));
    renderCellFeatureList(cell);
  }

  function populateGridFeatures() {
    for (const cell of cells) {
      const queryOptions = targetLayers.length > 0 ? { layers: targetLayers } : undefined;
      const features = map.queryRenderedFeatures(cell.bbox, queryOptions);
      updateCellAccessibility(cell, features);
    }
  }

  function setActiveCell(cell, focusCell = false) {
    if (!cell) {
      return;
    }

    for (const existingCell of cells) {
      existingCell.element.classList.remove('maplibre-gl-a11y-grid-cell-active');
      existingCell.element.tabIndex = -1;
    }

    cell.element.classList.add('maplibre-gl-a11y-grid-cell-active');
    cell.element.tabIndex = 0;

    if (focusCell) {
      cell.element.focus();
    }
  }

  function getCellAt(row, col) {
    if (row < 0 || col < 0 || row >= gridRows || col >= gridColumns) {
      return undefined;
    }
    return cells[row * gridColumns + col];
  }

  function panMapByCellOffset(dx, dy) {
    const canvas = map.getCanvas();
    const center = [
      canvas.clientWidth / 2 + dx,
      canvas.clientHeight / 2 + dy
    ];
    map.easeTo({
      center: map.unproject(center),
      duration: 250
    });
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
    gridColumns = columns;
    gridRows = rows;
    cells = [];

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
        cellElement.tabIndex = -1;
        cellElement.setAttribute('role', 'gridcell');
        cellElement.style.width = `${x2 - x1}px`;
        cellElement.style.height = `${y2 - y1}px`;
        cellElement.style.border = showGridBorder ? `${borderWidth}px solid ${borderColor}` : '0';

        const detailsContainer = document.createElement('section');
        detailsContainer.className = 'maplibre-gl-a11y-cell-details';
        detailsContainer.setAttribute('aria-hidden', 'true');

        const detailsHeading = document.createElement('h3');
        detailsHeading.className = 'maplibre-gl-a11y-details-heading';
        detailsContainer.appendChild(detailsHeading);

        const detailsList = document.createElement('ul');
        detailsList.className = 'maplibre-gl-a11y-details-list';
        detailsContainer.appendChild(detailsList);

        const cell = {
          row,
          col,
          element: cellElement,
          features: [],
          listHeading: detailsHeading,
          listElement: detailsList,
          bbox: [
            [x1, y1],
            [x2, y2]
          ]
        };

        const onActivateCell = (event) => {
          if (
            event.type === 'mouseenter' &&
            document.activeElement &&
            document.activeElement !== cell.element &&
            document.activeElement.classList &&
            document.activeElement.classList.contains('maplibre-gl-a11y-grid-cell')
          ) {
            document.activeElement.blur();
          }
          setActiveCell(cell, false);
        };
        const onDeactivateCell = () => {
          // Keep active state for keyboard users while focused.
          if (document.activeElement === cellElement) {
            return;
          }
          cellElement.classList.remove('maplibre-gl-a11y-grid-cell-active');
        };
        const onCellKeyDown = (event) => {
          const key = event.key;
          const isKeyZ = event.code === 'KeyZ';
          const isShiftZ = isKeyZ && event.shiftKey;
          const isZoomInZ = isKeyZ && !event.shiftKey;
          if (key === 'h' || key === 'H') {
            event.preventDefault();
            event.stopPropagation();
            announceKeyboardHelp();
            return;
          }
          if (key === 'c' || key === 'C') {
            event.preventDefault();
            event.stopPropagation();
            const x = (cell.bbox[0][0] + cell.bbox[1][0]) / 2;
            const y = (cell.bbox[0][1] + cell.bbox[1][1]) / 2;
            map.easeTo({
              center: map.unproject([x, y]),
              duration: 250
            });
            return;
          }
          if (isShiftZ) {
            event.preventDefault();
            event.stopPropagation();
            map.easeTo({
              zoom: map.getZoom() - 1,
              duration: 250
            });
            return;
          }
          if (isZoomInZ) {
            event.preventDefault();
            event.stopPropagation();
            map.easeTo({
              zoom: map.getZoom() + 1,
              duration: 250
            });
            return;
          }

          let targetCell;
          switch (key) {
            case 'ArrowUp':
              targetCell = getCellAt(cell.row - 1, cell.col);
              break;
            case 'ArrowDown':
              targetCell = getCellAt(cell.row + 1, cell.col);
              break;
            case 'ArrowLeft':
              targetCell = getCellAt(cell.row, cell.col - 1);
              break;
            case 'ArrowRight':
              targetCell = getCellAt(cell.row, cell.col + 1);
              break;
            case 'Home':
              targetCell = getCellAt(cell.row, 0);
              break;
            case 'End':
              targetCell = getCellAt(cell.row, gridColumns - 1);
              break;
            case 'Escape':
              event.preventDefault();
              event.stopPropagation();
              controlButton.focus();
              return;
            default:
              return;
          }

          if (!targetCell) {
            if (key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              panMapByCellOffset(0, -cellSize);
            } else if (key === 'ArrowDown') {
              event.preventDefault();
              event.stopPropagation();
              panMapByCellOffset(0, cellSize);
            } else if (key === 'ArrowLeft') {
              event.preventDefault();
              event.stopPropagation();
              panMapByCellOffset(-cellSize, 0);
            } else if (key === 'ArrowRight') {
              event.preventDefault();
              event.stopPropagation();
              panMapByCellOffset(cellSize, 0);
            }
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          setActiveCell(targetCell, true);
        };
        cellElement.addEventListener('mouseenter', onActivateCell);
        cellElement.addEventListener('focus', onActivateCell);
        cellElement.addEventListener('mouseleave', onDeactivateCell);
        cellElement.addEventListener('blur', onDeactivateCell);
        cellElement.addEventListener('keydown', onCellKeyDown);

        cellElement.appendChild(detailsContainer);
        overlayContainer.appendChild(cellElement);
        cells.push(cell);
      }
    }

    if (cells.length > 0) {
      setActiveCell(cells[0], false);
    }

    populateGridFeatures();

    idleHandler = () => {
      populateGridFeatures();
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
    cells = [];

    isGridVisible = false;
    if (reenableNativeKeyboard && map.keyboard) {
      map.keyboard.enable();
      reenableNativeKeyboard = false;
    }
    if (controlButton) {
      controlButton.setAttribute('aria-pressed', 'false');
    }
    if (keyboardHelpElement) {
      keyboardHelpElement.classList.add('maplibre-gl-a11y-keyboard-help-hidden');
    }
  }

  function toggleGridOverlay() {
    if (isGridVisible) {
      destroyGridOverlay();
      return;
    }

    overlayContainer = document.createElement('div');
    overlayContainer.className = 'maplibre-gl-a11y-grid-overlay';
    overlayContainer.setAttribute('role', 'grid');
    overlayContainer.setAttribute('aria-label', 'Accessibility grid overlay');
    if (keyboardHelpElementId) {
      overlayContainer.setAttribute('aria-describedby', keyboardHelpElementId);
    }
    map.getCanvasContainer().appendChild(overlayContainer);

    isGridVisible = true;
    if (map.keyboard && map.keyboard.isEnabled()) {
      map.keyboard.disable();
      reenableNativeKeyboard = true;
    }
    controlButton.setAttribute('aria-pressed', 'true');
    if (keyboardHelpElement) {
      keyboardHelpElement.classList.remove('maplibre-gl-a11y-keyboard-help-hidden');
    }
    buildGridOverlay();
    announceKeyboardHelp();
    if (cells.length > 0) {
      setActiveCell(cells[0], true);
    }
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

      keyboardHelpElement = document.createElement('div');
      keyboardHelpElement.className = 'maplibre-gl-a11y-keyboard-help maplibre-gl-a11y-keyboard-help-hidden';
      keyboardHelpElementId = 'maplibre-gl-a11y-keyboard-help';
      keyboardHelpElement.id = keyboardHelpElementId;
      keyboardHelpElement.setAttribute('role', 'note');
      keyboardHelpElement.innerHTML = `
        <strong>Keyboard controls</strong>
        <div>Arrows: move cell (or pan map at edge)</div>
        <div>Home/End: jump row start/end</div>
        <div>c: center map on selected cell</div>
        <div>z: zoom in, Shift+z: zoom out</div>
        <div>h: read keyboard help aloud</div>
        <div>Esc: return to a11y button</div>
      `;
      controlContainer.appendChild(keyboardHelpElement);

      srAnnouncementElement = document.createElement('div');
      srAnnouncementElement.className = 'maplibre-gl-a11y-sr-announcer';
      srAnnouncementElement.setAttribute('aria-live', 'polite');
      srAnnouncementElement.setAttribute('aria-atomic', 'true');
      controlContainer.appendChild(srAnnouncementElement);
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
      keyboardHelpElement = undefined;
      keyboardHelpElementId = undefined;
      srAnnouncementElement = undefined;
    }
  };
}
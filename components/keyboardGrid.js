import {
    dedupeFeatures,
    getFeatureLabel,
    getFeaturePropertiesForLayer,
    getLayerDisplayName,
    getPropertyDisplayName,
    buildFeatureSummary,
    buildInspectionBoxAnnouncement,
    speak
} from './helpers.js';

export function createKeyboardGridMode({
    map,
    targetLayers,
    layerProperties,
    layerAliases,
    propertyAliases,
    speechEnabled,
    getSpeechRate,
    cellSize,
    showGridBorder,
    borderColor,
    borderWidth,
    announceKeyboardHelp,
    announce,
    getControlButton,
    getKeyboardHelpElement,
    getKeyboardHelpElementId,
    getActiveMode,
    setMouseInteractionEnabled
}) {
    let overlayContainer;
    let idleHandler;
    let resizeHandler;
    let cells = [];
    let gridColumns = 0;
    let gridRows = 0;
    let reenableNativeKeyboard = false;
    let gridEventBlocker;
    let gridGlobalKeydownHandler;

    function buildCellAriaLabel(cell) {
        if (!Array.isArray(cell.features) || cell.features.length === 0) {
            return `row ${cell.row + 1} column ${cell.col + 1}: no features`;
        }

        const layerSummaries = {};
        for (const feature of cell.features) {
            const layerName = getLayerDisplayName(feature.layer?.id || '', layerAliases);
            if (!layerSummaries[layerName]) {
                layerSummaries[layerName] = [];
            }
            layerSummaries[layerName].push(buildFeatureSummary(feature, layerProperties, propertyAliases));
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
            const layerId = feature.layer?.id || '';
            const layerName = getLayerDisplayName(layerId, layerAliases);
            const title = document.createElement('div');
            title.className = 'maplibre-gl-a11y-feature-title';
            title.textContent = `${layerName}: ${getFeatureLabel(feature)}`;
            item.appendChild(title);

            const properties = getFeaturePropertiesForLayer(feature, layerProperties);
            const propertyEntries = Object.entries(properties);
            if (propertyEntries.length > 0) {
                const propertyList = document.createElement('ul');
                propertyList.className = 'maplibre-gl-a11y-property-list';
                for (const [key, value] of propertyEntries) {
                    const propItem = document.createElement('li');
                    propItem.textContent = `${getPropertyDisplayName(layerId, key, propertyAliases)}: ${String(value)}`;
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

    function getCenterCell() {
        if (!cells.length || gridRows === 0 || gridColumns === 0) {
            return undefined;
        }
        const centerRow = Math.floor(gridRows / 2);
        const centerCol = Math.floor(gridColumns / 2);
        return getCellAt(centerRow, centerCol) || cells[0];
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

    function queryFeaturesInInspectionBox(point) {
        const queryOptions = targetLayers.length > 0 ? { layers: targetLayers } : undefined;
        const halfSize = cellSize / 2;
        const bbox = [
            [point.x - halfSize, point.y - halfSize],
            [point.x + halfSize, point.y + halfSize]
        ];
        const features = map.queryRenderedFeatures(bbox, queryOptions);
        return dedupeFeatures(features);
    }

    function handleGridKeyDownForCell(cell, event) {
        const key = event.key;
        const isKeyZ = event.code === 'KeyZ';
        const isShiftZ = isKeyZ && event.shiftKey;
        const isZoomInZ = isKeyZ && !event.shiftKey;
        const isSpace = event.code === 'Space';
        if (isSpace) {
            event.preventDefault();
            event.stopPropagation();
            const selectedCell = getCellAt(cell.row, cell.col);
            const x = (selectedCell.bbox[0][0] + selectedCell.bbox[1][0]) / 2;
            const y = (selectedCell.bbox[0][1] + selectedCell.bbox[1][1]) / 2;
            const features = queryFeaturesInInspectionBox({x, y});
            const message = buildInspectionBoxAnnouncement(features, layerAliases, layerProperties, propertyAliases);
            speak(message, speechEnabled, getSpeechRate());
            return;
        }
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
                getControlButton()?.focus();
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
                    handleGridKeyDownForCell(cell, event);
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

    function deactivate() {
        if (idleHandler) {
            map.off('idle', idleHandler);
            idleHandler = undefined;
        }
        if (resizeHandler) {
            map.off('resize', resizeHandler);
            resizeHandler = undefined;
        }

        if (overlayContainer && overlayContainer.parentNode) {
            if (gridEventBlocker) {
                for (const eventName of ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'wheel', 'touchstart', 'touchmove', 'touchend']) {
                    overlayContainer.removeEventListener(eventName, gridEventBlocker, { capture: true });
                }
            }
            overlayContainer.parentNode.removeChild(overlayContainer);
        }
        if (gridGlobalKeydownHandler) {
            document.removeEventListener('keydown', gridGlobalKeydownHandler, true);
            gridGlobalKeydownHandler = undefined;
        }
        overlayContainer = undefined;
        gridEventBlocker = undefined;
        cells = [];

        if (reenableNativeKeyboard && map.keyboard) {
            map.keyboard.enable();
            reenableNativeKeyboard = false;
        }
        const keyboardHelpElement = getKeyboardHelpElement();
        if (keyboardHelpElement) {
            keyboardHelpElement.classList.add('maplibre-gl-a11y-keyboard-help-hidden');
        }
    }

    function activate() {
        overlayContainer = document.createElement('div');
        overlayContainer.className = 'maplibre-gl-a11y-grid-overlay';
        overlayContainer.setAttribute('role', 'grid');
        overlayContainer.setAttribute('aria-label', 'Accessibility grid overlay');
        const keyboardHelpElementId = getKeyboardHelpElementId();
        if (keyboardHelpElementId) {
            overlayContainer.setAttribute('aria-describedby', keyboardHelpElementId);
        }
        map.getCanvasContainer().appendChild(overlayContainer);
        gridEventBlocker = (event) => {
            event.preventDefault();
            event.stopPropagation();
        };
        for (const eventName of ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'wheel', 'touchstart', 'touchmove', 'touchend']) {
            overlayContainer.addEventListener(eventName, gridEventBlocker, { capture: true });
        }
        gridGlobalKeydownHandler = (event) => {
            const navigationKeys = new Set([
                'ArrowUp',
                'ArrowDown',
                'ArrowLeft',
                'ArrowRight',
                'Home',
                'End',
                'Escape',
                'Space',
                'Spacebar',
                'h',
                'H',
                'c',
                'C'
            ]);
            const isZoomShortcut = event.code === 'KeyZ';
            if (!navigationKeys.has(event.key) && !isZoomShortcut) {
                return;
            }
            if (getActiveMode() !== 'grid') {
                return;
            }
            if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('maplibre-gl-a11y-grid-cell')) {
                return;
            }
            const activeCell = cells.find((gridCell) =>
                gridCell.element.classList.contains('maplibre-gl-a11y-grid-cell-active')
            ) || getCenterCell();
            if (!activeCell) {
                return;
            }
            setActiveCell(activeCell, true);
            handleGridKeyDownForCell(activeCell, event);
        };
        document.addEventListener('keydown', gridGlobalKeydownHandler, true);

        setMouseInteractionEnabled(map, false);
        if (map.keyboard && map.keyboard.isEnabled()) {
            map.keyboard.disable();
            reenableNativeKeyboard = true;
        }
        const keyboardHelpElement = getKeyboardHelpElement();
        if (keyboardHelpElement) {
            keyboardHelpElement.classList.remove('maplibre-gl-a11y-keyboard-help-hidden');
        }
        buildGridOverlay();
        announceKeyboardHelp();
        const centerCell = getCenterCell();
        if (centerCell) {
            window.requestAnimationFrame(() => {
                setActiveCell(centerCell, true);
            });
        }
        announce('Grid mode active. Map mouse interaction disabled.', true);
    }

    return {
        activate,
        deactivate
    };
}

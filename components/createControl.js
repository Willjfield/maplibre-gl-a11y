import { ICON_PATH_D, GRID_ICON_PATH_D, MAP_ICON_PATH_D, SPEAKER_ICON_PATH_D } from './icons.js';
import { normalizeLayerConfig, ensureControlStyles, setMouseInteractionEnabled, createIcon } from './helpers.js';
import { createKeyboardGridMode } from './keyboardGrid.js';
import { createAccessibleStyleMode } from './a11yStyle.js';
import { createMouseSpeakerMode } from './mouseSpeaker.js';

const DEFAULT_CELL_SIZE = 48;

export default function createControl(map, options = {}) {
  const cellSize = Math.max(8, Number(options.cellSize) || DEFAULT_CELL_SIZE);
  const { targetLayers, layerProperties } = normalizeLayerConfig(options);
  const showGridBorder = options.showGridBorder !== false;
  const borderColor = options.borderColor || 'rgba(56, 135, 190, 0.6)';
  const borderWidth = Number.isFinite(options.borderWidth) ? options.borderWidth : 1;
  const accessibleStyle = options.accessibleStyle;
  const speechEnabled = options.speechEnabled !== false;
  const layerAliases = options.layerAliases && typeof options.layerAliases === 'object' ? options.layerAliases : {};
  const propertyAliases = options.propertyAliases && typeof options.propertyAliases === 'object' ? options.propertyAliases : {};

  let controlContainer;
  let controlButton;
  let modePanel;
  let gridModeButton;
  let styleModeButton;
  let audioModeButton;
  let activeMode = 'off';
  let isPanelOpen = false;
  let keyboardHelpElement;
  let keyboardHelpElementId;
  let srAnnouncementElement;
  let togglePanelHandler;
  const initialStyle = options.defaultStyle || map.getStyle();
  const gridMode = createKeyboardGridMode({
    map,
    targetLayers,
    layerProperties,
    layerAliases,
    propertyAliases,
    cellSize,
    showGridBorder,
    borderColor,
    borderWidth,
    announceKeyboardHelp,
    announce,
    getControlButton: () => controlButton,
    getKeyboardHelpElement: () => keyboardHelpElement,
    getKeyboardHelpElementId: () => keyboardHelpElementId,
    getActiveMode: () => activeMode,
    setMouseInteractionEnabled
  });
  const styleMode = createAccessibleStyleMode({
    map,
    accessibleStyle,
    initialStyle,
    announce
  });
  const audioMode = createMouseSpeakerMode({
    map,
    targetLayers,
    layerProperties,
    layerAliases,
    propertyAliases,
    speechEnabled,
    announce
  });

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

  function announce(message, assertive = false) {
    if (!srAnnouncementElement) {
      return;
    }
    srAnnouncementElement.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    srAnnouncementElement.textContent = '';
    window.requestAnimationFrame(() => {
      srAnnouncementElement.textContent = message;
    });
  }

  

  function closeModePanel() {
    if (!modePanel || !controlButton) {
      return;
    }
    isPanelOpen = false;
    modePanel.classList.add('maplibre-gl-a11y-mode-panel-hidden');
    controlButton.setAttribute('aria-expanded', 'false');
  }

  function openModePanel() {
    if (!modePanel || !controlButton) {
      return;
    }
    isPanelOpen = true;
    modePanel.classList.remove('maplibre-gl-a11y-mode-panel-hidden');
    controlButton.setAttribute('aria-expanded', 'true');
  }

  function updateModeButtonState() {
    if (gridModeButton) {
      gridModeButton.setAttribute('aria-pressed', String(activeMode === 'grid'));
    }
    if (styleModeButton) {
      styleModeButton.setAttribute('aria-pressed', String(activeMode === 'altStyle'));
    }
    if (audioModeButton) {
      audioModeButton.setAttribute('aria-pressed', String(activeMode === 'audioExplore'));
    }
  }

  function setMode(nextMode) {
    if (activeMode === nextMode) {
      nextMode = 'off';
    }

    if (activeMode === 'grid') {
      gridMode.deactivate();
    } else if (activeMode === 'altStyle') {
      styleMode.deactivate();
    } else if (activeMode === 'audioExplore') {
      audioMode.deactivate();
    }

    activeMode = nextMode;
    closeModePanel();

    if (activeMode === 'grid') {
      gridMode.activate();
    } else if (activeMode === 'altStyle') {
      const styleActivated = styleMode.activate();
      if (!styleActivated) {
        activeMode = 'off';
      }
    } else if (activeMode === 'audioExplore') {
      setMouseInteractionEnabled(map, true);
      audioMode.activate();
    } else {
      setMouseInteractionEnabled(map, true);
      map.getCanvas().style.cursor = '';
      announce('Accessibility mode cleared.', false);
    }

    updateModeButtonState();
  }

  return {
    onAdd() {
      ensureControlStyles();

      controlContainer = document.createElement('div');
      controlContainer.className = 'maplibregl-ctrl maplibregl-ctrl-group maplibre-gl-a11y-control';

      controlButton = document.createElement('button');
      controlButton.type = 'button';
      controlButton.className = 'maplibre-gl-a11y-control-button';
      controlButton.setAttribute('aria-label', 'Open accessibility interaction modes');
      controlButton.setAttribute('aria-expanded', 'false');
      controlButton.setAttribute('aria-haspopup', 'true');
      controlButton.title = 'Open accessibility interaction modes';
      controlButton.appendChild(createIcon(ICON_PATH_D, '0 0 1200 1200'));
      togglePanelHandler = () => {
        if (isPanelOpen) {
          closeModePanel();
        } else {
          openModePanel();
        }
      };
      controlButton.addEventListener('click', togglePanelHandler);

      controlContainer.appendChild(controlButton);

      modePanel = document.createElement('div');
      modePanel.className = 'maplibre-gl-a11y-mode-panel maplibre-gl-a11y-mode-panel-hidden';
      modePanel.setAttribute('role', 'group');
      modePanel.setAttribute('aria-label', 'Accessibility interaction modes');

      gridModeButton = document.createElement('button');
      gridModeButton.type = 'button';
      gridModeButton.className = 'maplibre-gl-a11y-mode-button';
      gridModeButton.setAttribute('aria-label', 'Grid mode');
      gridModeButton.title = 'Grid mode: use keyboard grid and disable map mouse interaction';
      gridModeButton.appendChild(createIcon(GRID_ICON_PATH_D));
      gridModeButton.addEventListener('click', () => setMode('grid'));

      styleModeButton = document.createElement('button');
      styleModeButton.type = 'button';
      styleModeButton.className = 'maplibre-gl-a11y-mode-button';
      styleModeButton.setAttribute('aria-label', 'Accessible style mode');
      styleModeButton.title = 'Accessible style mode';
      styleModeButton.appendChild(createIcon(MAP_ICON_PATH_D));
      styleModeButton.addEventListener('click', () => setMode('altStyle'));

      audioModeButton = document.createElement('button');
      audioModeButton.type = 'button';
      audioModeButton.className = 'maplibre-gl-a11y-mode-button';
      audioModeButton.setAttribute('aria-label', 'Audio explore mode');
      audioModeButton.title = 'Audio explore mode';
      audioModeButton.appendChild(createIcon(SPEAKER_ICON_PATH_D));
      audioModeButton.addEventListener('click', () => setMode('audioExplore'));

      modePanel.appendChild(gridModeButton);
      modePanel.appendChild(styleModeButton);
      modePanel.appendChild(audioModeButton);
      controlContainer.appendChild(modePanel);

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
      updateModeButtonState();
      return controlContainer;
    },
    onRemove() {
      setMode('off');
      if (controlButton) {
        controlButton.removeEventListener('click', togglePanelHandler);
      }
      if (controlContainer && controlContainer.parentNode) {
        controlContainer.parentNode.removeChild(controlContainer);
      }
      controlContainer = undefined;
      controlButton = undefined;
      modePanel = undefined;
      gridModeButton = undefined;
      styleModeButton = undefined;
      audioModeButton = undefined;
      keyboardHelpElement = undefined;
      keyboardHelpElementId = undefined;
      srAnnouncementElement = undefined;
      togglePanelHandler = undefined;
    }
  };
}
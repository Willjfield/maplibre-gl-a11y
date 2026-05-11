import { dedupeFeatures, buildFeatureSummary, getLayerDisplayName, buildInspectionBoxAnnouncement, speak } from './helpers.js';

const HOVER_ANNOUNCE_DEBOUNCE_MS = 700;
const AUDIO_INSPECTION_BOX_SIZE = 44;

export function createMouseSpeakerMode({
    map,
    targetLayers,
    layerProperties,
    layerAliases,
    propertyAliases,
    speechEnabled,
    getSpeechRate,
    announce
}) {
    let audioHoverTimeout;
    let audioLastAnnouncement = '';
    let magnifierElement;
    let previousCursorStyle = '';

    function queryFeaturesAtPoint(point) {
        const queryOptions = targetLayers.length > 0 ? { layers: targetLayers } : undefined;
        const features = map.queryRenderedFeatures(point, queryOptions);
        return dedupeFeatures(features);
    }

    function queryFeaturesInInspectionBox(point) {
        const queryOptions = targetLayers.length > 0 ? { layers: targetLayers } : undefined;
        const halfSize = AUDIO_INSPECTION_BOX_SIZE / 2;
        const bbox = [
            [point.x - halfSize, point.y - halfSize],
            [point.x + halfSize, point.y + halfSize]
        ];
        const features = map.queryRenderedFeatures(bbox, queryOptions);
        return dedupeFeatures(features);
    }

    function buildPointAnnouncement(features) {
        if (!features || features.length === 0) {
            return 'No features at pointer location.';
        }
        const topFeatures = features.slice(0, 3);
        const featureText = topFeatures.map((feature) => {
            const layerName = getLayerDisplayName(feature.layer?.id || '', layerAliases);
            return `${layerName}: ${buildFeatureSummary(feature, layerProperties, propertyAliases)}`;
        });
        const suffix = features.length > topFeatures.length ? ` plus ${features.length - topFeatures.length} more` : '';
        return `${featureText.join('; ')}${suffix}`;
    }

    

    function updateMagnifierPosition(point) {
        if (!magnifierElement) {
            return;
        }
        magnifierElement.style.left = `${point.x}px`;
        magnifierElement.style.top = `${point.y}px`;
    }

    function createMagnifier() {
        if (magnifierElement) {
            return;
        }
        magnifierElement = document.createElement('div');
        magnifierElement.className = 'maplibre-gl-a11y-magnifier';
        map.getCanvasContainer().appendChild(magnifierElement);
    }

    function destroyMagnifier() {
        if (magnifierElement && magnifierElement.parentNode) {
            magnifierElement.parentNode.removeChild(magnifierElement);
        }
        magnifierElement = undefined;
    }

    function handleAudioPointerMove(event) {
        updateMagnifierPosition(event.point);
        if (audioHoverTimeout) {
            window.clearTimeout(audioHoverTimeout);
        }
        audioHoverTimeout = window.setTimeout(() => {
            const features = queryFeaturesAtPoint(event.point);
            const message = buildPointAnnouncement(features);
            if (message === audioLastAnnouncement) {
                return;
            }
            audioLastAnnouncement = message;
            announce(message, false);
        }, HOVER_ANNOUNCE_DEBOUNCE_MS);
    }

    function handleAudioPointerClick(event) {
        const features = queryFeaturesInInspectionBox(event.point);
        const message = buildInspectionBoxAnnouncement(features, layerAliases, layerProperties, propertyAliases);
        announce(message, true);
        speak(message, speechEnabled, getSpeechRate());
    }

    function activate() {
        previousCursorStyle = map.getCanvas().style.cursor;
        map.getCanvas().style.cursor = 'crosshair';
        createMagnifier();
        map.on('mousemove', handleAudioPointerMove);
        map.on('click', handleAudioPointerClick);
        announce('Explore the map with the mouse and click to read features within the red square', true);
        speak('Explore the map with the mouse and click to read features within the red square', speechEnabled, getSpeechRate());
    }

    function deactivate() {
        if (audioHoverTimeout) {
            window.clearTimeout(audioHoverTimeout);
            audioHoverTimeout = undefined;
        }
        map.off('mousemove', handleAudioPointerMove);
        map.off('click', handleAudioPointerClick);
        map.getCanvas().style.cursor = previousCursorStyle;
        previousCursorStyle = '';
        audioLastAnnouncement = '';
        destroyMagnifier();
    }

    return {
        activate,
        deactivate
    };
}

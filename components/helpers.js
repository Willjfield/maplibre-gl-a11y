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

    if (Array.isArray(options.layerProperties)) {
        console.warn(
            'maplibre-gl-a11y: layerProperties should be an object keyed by layer id. Ignoring array input.'
        );
    } else if (options.layerProperties && typeof options.layerProperties === 'object') {
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

function setMouseInteractionEnabled(map, enabled) {
    const handlers = [
        map.dragPan,
        map.scrollZoom,
        map.boxZoom,
        map.dragRotate,
        map.doubleClickZoom,
        map.touchZoomRotate,
        map.touchPitch
    ];

    for (const handler of handlers) {
        if (!handler) {
            continue;
        }
        if (enabled) {
            handler.enable();
        } else {
            handler.disable();
        }
    }
}

function createIcon(pathDefinition, viewBox = '0 0 24 24') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathDefinition);
    svg.appendChild(path);
    return svg;
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

function getFeaturePropertiesForLayer(feature, layerProperties) {
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

function getLayerDisplayName(layerId, layerAliases) {
    if (typeof layerAliases[layerId] === 'string' && layerAliases[layerId].trim()) {
        return layerAliases[layerId];
    }
    return layerId || 'unknown-layer';
}

function getPropertyDisplayName(layerId, propertyName, propertyAliases) {
    const globalAlias = propertyAliases[propertyName];
    if (typeof globalAlias === 'string' && globalAlias.trim()) {
        return globalAlias;
    }

    const layerSpecificAliases = propertyAliases[layerId];
    if (
        layerSpecificAliases &&
        typeof layerSpecificAliases === 'object' &&
        !Array.isArray(layerSpecificAliases) &&
        typeof layerSpecificAliases[propertyName] === 'string' &&
        layerSpecificAliases[propertyName].trim()
    ) {
        return layerSpecificAliases[propertyName];
    }

    return propertyName;
}

function buildFeatureSummary(feature, layerProperties, propertyAliases) {
    const properties = getFeaturePropertiesForLayer(feature, layerProperties);
    const propertyEntries = Object.entries(properties);
    const layerId = feature.layer?.id || '';

    if (propertyEntries.length === 0) {
        return getFeatureLabel(feature);
    }

    return propertyEntries
        .map(([key, value]) => `${getPropertyDisplayName(layerId, key, propertyAliases)}:${String(value)}`)
        .join(', ');
}

function buildInspectionBoxAnnouncement(features, layerAliases, layerProperties, propertyAliases) {
    if (!features || features.length === 0) {
        return 'No features found.';
    }
    const details = features.map((feature, index) => {
        const layerName = getLayerDisplayName(feature.layer?.id || '', layerAliases);
        return `Feature ${index + 1} in ${layerName}: ${buildFeatureSummary(feature, layerProperties, propertyAliases)}`;
    });
    return `${features.length} features. ${details.join('; ')}`;
}

function clampSpeechSynthesisRate(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n)) {
        return 1;
    }
    return Math.min(10, Math.max(0.1, n));
}

function speak(message, speechEnabled, rate = 1) {
    if (!speechEnabled || typeof window === 'undefined' || typeof window.SpeechSynthesisUtterance !== 'function') {
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(message);
    utterance.rate = clampSpeechSynthesisRate(rate);
    window.speechSynthesis.speak(utterance);
}

export {
    getFeatureLabel,
    normalizeLayerConfig,
    ensureControlStyles,
    setMouseInteractionEnabled,
    createIcon,
    dedupeFeatures,
    getFeaturePropertiesForLayer,
    getLayerDisplayName,
    getPropertyDisplayName,
    buildFeatureSummary,
    buildInspectionBoxAnnouncement,
    clampSpeechSynthesisRate,
    speak
};
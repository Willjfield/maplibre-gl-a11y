# maplibre-gl-a11y

Accessibility tooling for `maplibre-gl-js`, including:

- an in-map accessibility control with multiple interaction modes
- a companion CLI that audits and generates accessibility-oriented style variants

## Install

```bash
npm install @willjfield/maplibre-gl-a11y
```

## Plugin Usage

```js
import maplibregl from 'maplibre-gl';
import { installMapLibreA11y } from '@willjfield/maplibre-gl-a11y';

installMapLibreA11y(maplibregl);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json'
});

map.addAccessability({
  accessibleStyle: 'https://example.com/a11y-style.json',
  layers: [{ id: 'countries-fill', properties: ['NAME'] }],
  layerAliases: { 'countries-fill': 'Countries' },
  propertyAliases: { NAME: 'Country Name' }
});
```

The plugin installs two methods onto `Map`:

- `map.addAccessability(options?)` to add the control
- `map.hideAccessibility()` to remove it

Note: `addAccessability` intentionally uses that spelling for backward compatibility.

## Accessibility Control Modes

Selecting the accessibility button opens a 3-icon mode panel:

- `Grid mode`:
  - shows a keyboard-navigable feature grid overlay
  - disables map mouse/touch interaction while active
  - blocks map pointer events behind the grid
  - supports keyboard actions (arrows, Home/End, `c`, `z`/`Shift+z`, `h`, `Esc`)
- `Accessible style mode`:
  - switches to `options.accessibleStyle` if provided
  - restores the original map style when the mode is turned off or switched
- `Audio explore mode`:
  - sets the map cursor to crosshair
  - shows a red square inspection overlay following the pointer
  - hover updates a screen-reader live region with feature summaries
  - click reads all features/properties within the red square bounding box
  - announces and speaks:
    - `Explore the map with the mouse and click to read features within the red square`

## `addAccessability` Options

- `placement` (`string`): MapLibre control placement (default: `top-left`)
- `accessibleStyle` (`string | object`): style URL or style object used by Accessible style mode
- `layers` (`string[] | { id: string; properties?: string[] }[]`): optional layer filter and per-layer property allowlist
- `layerProperties` (`Record<string, string[]>`): optional per-layer property allowlist
- `layerAliases` (`Record<string, string>`): optional display names for layer ids in spoken/text output
- `propertyAliases` (`Record<string, string> | Record<string, Record<string, string>>`):
  optional display names for property keys, either global or layer-specific
- `cellSize` (`number`): grid cell size in pixels (default: `48`, min `8`)
- `showGridBorder` (`boolean`): show/hide cell borders (default: `true`)
- `borderColor` (`string`): grid border color
- `borderWidth` (`number`): grid border width
- `speechEnabled` (`boolean`): enable browser speech synthesis for spoken output (default: `true`)

## CLI Usage

```bash
cp ./.maplibre-gl-a11y.config.example.json ./.maplibre-gl-a11y.config.json
# edit API keys/provider in ./.maplibre-gl-a11y.config.json
node ./bin/style-analyzer.js ./path/to/style.json
```

You can also pass config explicitly (recommended when installed in another project):

```bash
maplibre-gl-a11y-cli ./path/to/style.json ./path/to/.maplibre-gl-a11y.config.json
# or
maplibre-gl-a11y-cli ./path/to/style.json --config ./path/to/.maplibre-gl-a11y.config.json
```

The CLI:

- reads the input style
- sends a compact style snapshot to your configured provider (`anthropic`, `openai`, or `gemini`) for WCAG-focused audit
- requests RFC6902 JSON patch suggestions with WCAG citations
- lets you apply `all`, `none`, or a comma-separated subset interactively
- writes output to `a11y_[name].json` beside the input style

### Non-interactive Mode

```bash
node ./bin/style-analyzer.js ./path/to/style.json --non-interactive
```

This writes `a11y_[name].json` without applying suggestions (baseline copy with audit output in terminal).

## Scripts

- `npm run build`: build ESM and minified UMD bundles into `dist/`
- `npm run demo`: build first, then start Vite demo server

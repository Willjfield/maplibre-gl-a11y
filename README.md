# maplibre-gl-a11y

Scaffold for a `maplibre-gl-js` accessibility plugin and companion CLI.

## Install

```bash
npm install
```

## Plugin usage

```js
import maplibregl from 'maplibre-gl';
import { installMapLibreA11y } from '@willjfield/maplibre-gl-a11y';

installMapLibreA11y(maplibregl);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json'
});

map.addAccessability();
map.hideAccessibility();
```

Both methods currently log `hello world`.

## CLI usage

```bash
cp ./.maplibre-gl-a11y.config.example.json ./.maplibre-gl-a11y.config.json
# edit API keys/provider in .maplibre-gl-a11y.config.json
node ./bin/style-analyzer.js ./path/to/style.json
```

The CLI now:

- reads the input style
- sends a compact style snapshot to your configured provider (`anthropic`, `openai`, or `gemini`) for WCAG-focused audit
- requests suggested RFC6902 JSON patch edits with WCAG citations
- lets you apply `all`, `none`, or a comma-separated subset interactively
- writes output to `a11y_[name].json` in the same folder as the input style

### Non-interactive mode

```bash
node ./bin/style-analyzer.js ./path/to/style.json --non-interactive
```

This writes `a11y_[name].json` without applying suggestions (baseline copy with audit output in terminal).

## Scripts

- `npm run build` - Build ESM and minified UMD bundles into `dist/`
- `npm run demo` - Build first, then start Vite demo server

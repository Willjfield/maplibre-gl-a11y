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
node ./bin/style-analyzer.js ./path/to/style.json
```

If the file is readable, it logs:

```text
Read style.json successfully
```

Otherwise it throws an error.

## Scripts

- `npm run build` - Build ESM and minified UMD bundles into `dist/`
- `npm run demo` - Build first, then start Vite demo server

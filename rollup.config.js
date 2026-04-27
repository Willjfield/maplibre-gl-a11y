import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

export default {
  input: 'index.js',
  output: [
    {
      file: 'dist/maplibre-gl-a11y.esm.js',
      format: 'es'
    },
    {
      file: 'dist/maplibre-gl-a11y.min.js',
      format: 'umd',
      name: 'MapLibreGLA11y',
      exports: 'named',
      globals: {},
      plugins: [
        terser({
          compress: {
            drop_console: false
          }
        })
      ]
    }
  ],
  plugins: [
    nodeResolve({
      preferBuiltins: false
    }),
    commonjs()
  ]
};

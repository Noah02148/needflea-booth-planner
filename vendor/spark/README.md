# Spark 2.4.0

`spark.module.js` and `LICENSE` are unmodified files from `@sparkjsdev/spark@2.4.0` (MIT).
The module bundles its decoder WASM and worker sources; it imports `three` and
`three/addons/postprocessing/Pass.js` through the page import map. `Pass.js` is
vendored from the project's pinned `three@0.186.1` under `vendor/three/postprocessing/`.

Source: https://github.com/sparkjsdev/spark
Docs: https://sparkjs.dev/docs/

To upgrade, install an explicit package version with `--ignore-scripts --save-exact`,
copy its unmodified module and license, check the Three.js peer dependency and import
paths, then run `node scripts/check-marble.mjs` plus the environment/Codex regressions.
No build or CDN is required to serve this integration.

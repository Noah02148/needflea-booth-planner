# Three.js browser distribution

Pinned version: **0.186.1**, matching `package.json` and `package-lock.json`.

Files copied without modification from the npm `three` package:

- `build/three.module.js`
- `build/three.core.js`
- `examples/jsm/controls/OrbitControls.js`
- `LICENSE` (MIT)

These files are checked in so the static GitHub Pages site and local viewer can
run without `node_modules`, a build step or a third-party CDN. `index.html` maps
the `three` module specifier to this directory. Keep both build files together.

When upgrading, update the pinned npm version and lockfile, then copy the same
four files from that version and run `node scripts/check-environment.mjs` against
a local static server. Do not edit generated vendor sources by hand.

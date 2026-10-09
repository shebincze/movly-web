#!/usr/bin/env node

// Compatibility entry point. The canonical implementation lives with the
// Windows release tooling so documentation and automation cannot drift.
await import('../../Windows/scripts/build-windows-manifest.mjs');

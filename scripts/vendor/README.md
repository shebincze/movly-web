Acorn 8.15.0, MIT, vendored from https://registry.npmjs.org/acorn/-/acorn-8.15.0.tgz
(package/dist/acorn.js). Used only by Node verification, never served as TV runtime.
Pinned locally so npm run check always parses legacy scripts with ecmaVersion: 5,
including the existing hls.js 0.14.17 distribution. No install/build step required.

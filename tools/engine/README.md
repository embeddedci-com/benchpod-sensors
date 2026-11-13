# Vendored sensor engine

`sensor_def.wasm` and `sensor_def.mjs` are the BenchPod's sensor definition engine built as
WebAssembly, with its ES module wrapper: the same code the pod, the server and the web and
desktop apps run. The library's checks (`tools/validate.mjs`, `tests/`) use it, so a definition
that passes here loads on a pod with the same firmware.

- Source: [benchpod-firmware](https://github.com/embeddedci-com/benchpod-firmware), commit
  `e95ff6a21ba00e2a61e50a77701afce83c531d13` (firmware 3.10.2 development, branch `gw-word-registers`: word registers and the
  command map), the engine's WASM build (`make` in its `wasm/` directory). ABI version 1.
- `SHA256SUMS` lists both files; `shasum -a 256 -c SHA256SUMS` (or `sha256sum -c`) checks them.

To update: build the engine at the new firmware commit, copy both files here, regenerate
`SHA256SUMS`, change the commit above and run the checks.

Unmodified reader assets from `zxing-wasm` 3.1.5:

- Package: https://registry.npmjs.org/zxing-wasm/-/zxing-wasm-3.1.5.tgz
- Package integrity (SHA-512): `jmxXvTCR/qZxMz2XwR6V+nL2BlDTD1aux7ZWSH9BV77TG9u4k0VyHba/NCCHBHJ60Wg6VV0QL/SMlJczKhJI4w==`
- Upstream: https://github.com/Sec-ant/zxing-wasm
- ZXing-C++ commit: `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`
- WASM SHA-256: `aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`

`dist/es/share.js` and `dist/es/reader/index.js` preserve their relative paths.
`dist/reader/zxing_reader.wasm` is served beside `reader/index.js` using the
application's explicit `locateFile` override. No CDN is used at runtime.
Only QR detection is enabled (`formats: ["QRCode"]`). The reader binary contains
other formats, but those detection paths are disabled. Writer assets are omitted.

The wrapper's MIT license is in `LICENSE`; the decoder's Apache 2.0 license is
in `ZXING-CPP-LICENSE`. Source and build instructions are available upstream.

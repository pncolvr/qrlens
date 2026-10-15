# QR Lens

A private camera, image, and PDF QR scanner that runs entirely in your browser.

Place a QR code inside the camera’s scan square, or choose an image and select **Use whole image** to scan it immediately. You can also drag a box around a QR code and read only that region. Scanning stops when a code is detected and presents the available actions. Actions run only when you select them.

Choose or drop a PDF to scan every page automatically. Each page lists its distinct QR payloads and detection debug previews, including pages with no code or a scan error. Open any QR result to see its actions and source page, then return to the page list. Identical payloads on different pages remain separate results. Scanning can be stopped while keeping completed page results. Password-protected PDFs require an unlocked copy.

| QR content | Action |
| --- | --- |
| Websites, including bare domains and `URLTO` links | Open website |
| Digital business cards (`vCard`, `MECARD`, or `.vcf` links) | Preview and save a contact file, or open the contact link |
| Plain text | Select or copy text |
| Wi-Fi | Copy network name and password; connect in device settings |
| PDF links | Open PDF; links without a `.pdf` path still open as websites |
| App Store / Google Play links, including `itms-apps` and `market` | Open store |
| Email addresses, `mailto`, and `MATMSG` | Compose email |
| Phone numbers, SMS, and MMS links | Call or compose message |
| Map coordinates (`geo`) | Open map |
| Calendar events (`VEVENT` / `VCALENDAR`) | Save an `.ics` file for import into a calendar |
| Other app links (custom URI schemes) | Open app |

Contact and calendar files are generated locally. Hosted business-card pages, payment pages, and social profiles work through their website or app links. Files and external links are handled by your browser or installed apps.

Format references: [ZXing QR contents](https://github.com/zxing/zxing/wiki/Barcode-Contents), [vCard](https://www.rfc-editor.org/rfc/rfc6350), [iCalendar](https://www.rfc-editor.org/rfc/rfc5545), [Google Play links](https://developer.android.com/distribute/marketing-tools/linking-to-google-play), and [Apple App Store links](https://developer.apple.com/news/?id=06142019a).

Unknown content is displayed as selectable text with a copy button. Every result can be copied, and **Scan another** starts the camera again.

- Rear camera preferred, with switching between available cameras
- Camera scans a centered crop, with a full-frame fallback about once per second
- Choose an image or PDF from your device, or drop files anywhere in the app; the first supported file opens locally
- Scan the whole image, or select a QR region with mouse, touch, or keyboard
- **Use whole image** first searches for QR finder-pattern triples in a preview capped at 1280 pixels, tries up to six proposed crops from the original image, and falls back to decoding the full image at up to 2560 pixels
- Image decoding tries 0°, 90°, 180°, and 270° clockwise at each resolution, stopping as soon as a code is decoded; this also applies to manual selections and full-image fallback
- Expand **Detection debug** to see finder responses, numbered attempts, decode resolutions and rotations, and whether full-image fallback succeeded; the preview remains available with the result
- PDF pages render on a white background with a longest side of 2048 pixels; pages with no result retry at 3072 pixels with a larger finder-analysis preview
- PDF scanning tries finder crops, four rotations, full-page decoding, and overlapping page tiles; decoded symbols are masked in a working copy to search for other codes
- No network uploads or scan history; pages are processed sequentially and debug previews are compressed to limit memory use
- Installable PWA; offline scanning after the first load
- English, Portuguese, and Spanish translations

## Running locally

```bash
python3 serve.py 8000
```

Open `http://localhost:8000/index.html`. Camera access requires permission and HTTPS when accessing from another device.

To preview the switch-camera button with one camera, open `http://localhost:8000/index.html?showCameraSwitch=1` and turn on the camera. This parameter works only on localhost or loopback addresses; switching still requires multiple cameras.

## Tech

Vanilla HTML/CSS/JS and [jsQR](https://github.com/cozmo/jsQR). The pinned jsQR 1.4.0 decoder is bundled locally in `src/vendor`, including its Apache 2.0 license. No build step or CDN connection is required at runtime.

[PDF.js 6.4.299](https://github.com/mozilla/pdf.js/releases/tag/v6.4.299) is bundled in `src/vendor/pdfjs-6.4.299`, including its worker, fonts, CMaps, image-decoder assets, and licenses. It is loaded only when a PDF is opened. The service worker caches these assets for offline PDF scanning after the first successful installation. The bundled PDF assets add approximately 6.4 MB to the offline cache. PDF pages use the same QR scanner as images; detection remains heuristic, so a damaged or extremely small QR may still be unreadable.

The lightweight region proposer checks 1:1:3:1:1 runs in both axes, groups finder candidates, and checks the geometry of triples before asking jsQR to verify a crop. Its response map is a heuristic, not a confidence probability. Very small, low-contrast, or strongly distorted codes may need the full-image fallback or a manual selection. Region analysis adds overhead when it cannot narrow the search; it does not guarantee a speedup for every image. Explicit manual selections never scan outside their bounds. See [jsQR’s locator](https://github.com/cozmo/jsQR/blob/master/src/locator/index.ts) for the finder-pattern approach used by the decoder itself.

## Checks

```bash
node --test tests/*.test.mjs
```

## License

MIT — see [LICENSE](LICENSE). jsQR retains its own license in `src/vendor/jsQR-LICENSE.txt`; PDF.js and its bundled assets retain their licenses in `src/vendor/pdfjs-6.4.299`.

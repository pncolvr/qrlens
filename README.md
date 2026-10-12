# QR Lens

A private camera QR scanner that runs entirely in your browser.

Point the camera at a QR code. Scanning stops when a code is detected and presents the available actions. Actions run only when you select them.

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
- No uploads, scan history, or document processing
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

## Checks

```bash
node --test tests/*.test.mjs
```

## License

MIT — see [LICENSE](LICENSE). jsQR retains its own license in `src/vendor/jsQR-LICENSE.txt`.

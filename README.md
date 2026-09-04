# GemClean

A Next.js, local-first tool for repairing known visible Gemini, Veo, and Google Flow corner marks on media you own or are authorized to edit.

## How it works

- Images use calibrated 36/48/96-pixel alpha maps and reverse-alpha restoration from `@pilio/gemini-watermark-remover`.
- Videos are decoded and encoded locally with Mediabunny and WebCodecs, with compatible audio packets copied into the MP4 result.
- Media stays in browser memory. There are no upload routes, API keys, accounts, credits, or storage services.
- Invisible SynthID and unrelated watermarks are intentionally out of scope.

## Flow project imports

The **Import Flow project** workspace supports the strongest officially available integration:

- Open a Flow project export or Google Takeout ZIP directly in the browser.
- Open an unpacked export folder when the browser supports folder selection.
- Optionally select an exported ZIP from Google Drive with Google Identity Services and Drive Picker.
- Review projects and thumbnails, select images, process them sequentially, compare full uncropped results, and download one file or a project-preserving ZIP.
- Video and audio entries remain visible in the gallery but are not changed in this image-focused phase.

GemClean does not claim access to live Flow projects. Google does not expose a public Flow project API or a Flow-specific OAuth scope. Drive integration only downloads the one exported ZIP selected by the user. Files and OAuth access tokens remain in browser memory and are not sent to a GemClean server or persisted.

## Local development

Node.js 20.9 or newer is required.

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

With a local server running on port 3000, the Playwright smoke test covers ZIP import, project grouping, unsupported-video visibility, the full-height mobile preview, sequential image processing, and the result ZIP action:

```bash
npm run test:browser
```

## Optional Google Drive Picker setup

Local ZIP and folder imports need no credentials. To enable the Drive button:

1. Create or select a Google Cloud project, then enable the **Google Picker API** and **Google Drive API**.
2. Configure the OAuth consent screen. Add the non-sensitive `drive.file` scope and test users while the app is in testing mode.
3. Create an OAuth 2.0 **Web application** client. Add the origins you actually use, for example `http://localhost:3000`, `http://127.0.0.1:3000`, your Vercel preview origin, and your production origin. Do not add paths to an authorized JavaScript origin.
4. Create a browser API key. Restrict it to website referrers for those origins (for example `http://localhost:3000/*` and `https://your-domain.example/*`) and restrict the key to the Picker and Drive APIs.
5. Copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_API_KEY=your-browser-api-key
NEXT_PUBLIC_GOOGLE_APP_ID=your-google-cloud-project-number
```

`NEXT_PUBLIC_GOOGLE_APP_ID` is the numeric Google Cloud project number, not the OAuth client ID. Restart `npm run dev` after changing public environment variables because Next.js inlines them into the browser bundle at build time. Add the same variables to the Vercel project for Preview and Production environments, then redeploy.

To use Takeout-to-Drive, export the Flow data with Google Takeout (or download a project from Flow), place the resulting ZIP in Drive, then choose that ZIP in GemClean. The Picker requests only `drive.file`; it does not browse or scrape private Flow endpoints.

## Import safety

- Archive paths are normalized and traversal/absolute paths are rejected.
- ZIP CRC and overlapping-entry checks are enabled.
- Metadata files are capped at 8 MB and individual archive entries above 512 MB are skipped.
- `projects.json` and adjacent `_metadata.json` files are parsed defensively. Unknown layouts fall back to **Ungrouped media** instead of dropping images.
- PNG, JPEG, and WebP images are processed. Supported video/audio file types are displayed as unsupported for this phase.

## Deployment

Import the repository into Vercel. The standard Next.js build settings are detected automatically. No environment variables are required for local ZIP/folder imports; configure the three public Google variables above only if Drive Picker is wanted.

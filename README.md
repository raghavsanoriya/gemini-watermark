# GemClean

A Next.js, local-first tool for repairing known visible Gemini, Veo, and Google Flow corner marks on media you own or are authorized to edit.

## How it works

- Images use calibrated 36/48/96-pixel alpha maps and reverse-alpha restoration from `@pilio/gemini-watermark-remover`.
- A residual check measures how much of the mark is still visible after reverse-alpha removal. Only then is the corner repainted with the MI-GAN inpainting model. Telea inpainting is kept only as an offline fallback for clipped or black output.
- **Batch images**: drop or choose many images, clean them one by one, and download one ZIP.
- **HEIC photos** are decoded to PNG locally (natively in Safari, with heic2any elsewhere) before cleaning.
- Videos are decoded and encoded locally with Mediabunny and WebCodecs, with compatible audio packets copied into the MP4 result.
- In the default (local) mode, media stays in browser memory and nothing is uploaded. No account is ever needed. Optional server mode is described below.
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

## Server mode (optional)

Builds that are not a static export (`next dev`, `next start`, Vercel) add an optional **Upload to server** choice next to the free local mode, in the single-file view:

- No accounts, credits, or storage. The server cleans the image **in memory** with the same pipeline as the browser (reverse-alpha, residual check, MI-GAN) and returns the PNG in the same response. Nothing is written to disk.
- Images only, up to 4 MB by default (Vercel rejects request bodies over 4.5 MB). Larger files and video stay on the free local mode.
- A simple per-address limit (20 images per 10 minutes by default) curbs abuse. It is kept in memory per server instance, so it is best-effort rather than an exact global quota.

The API route is `src/app/api/clean/route.server.ts`. The `.server.ts` suffix keeps it out of the GitHub Pages export, which stays fully local.

| Variable | Purpose |
| --- | --- |
| `GEMCLEAN_MAX_UPLOAD_MB` and `NEXT_PUBLIC_SERVER_MAX_UPLOAD_MB` | Upload limit (server and UI). Keep them equal and at most 4 on Vercel. |
| `GEMCLEAN_RATE_LIMIT`, `GEMCLEAN_RATE_WINDOW_MINUTES` | Images per address per window. |

Deploying to Vercel needs no environment variables. The build downloads the MI-GAN model, and `outputFileTracingIncludes` ships it with the clean function.

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
- PNG, JPEG, WebP, and HEIC images are processed. Supported video/audio file types are displayed as unsupported for this phase.

## Deployment

Pushes to `main` build a static, local-only Next.js export (no server mode) and deploy it to GitHub Pages at `https://raghavsanoriya.github.io/gemini-watermark/`. The workflow runs lint, type checking, and unit tests before deployment. Add the optional Google values as GitHub Actions repository variables if Drive Picker is wanted on Pages.

The same repository can also be imported into Vercel. Standard Next.js build settings are detected automatically. No environment variables are required for local ZIP/folder imports; configure the three public Google variables above only if Drive Picker is wanted.

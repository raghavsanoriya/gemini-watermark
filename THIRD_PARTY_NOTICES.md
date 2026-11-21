# Third-party notices

## Telea browser implementation

The TypeScript Telea inpainting implementation in `src/lib/processors/telea-inpaint.ts`
is adapted from [maxgfr/unmark](https://github.com/maxgfr/unmark), copyright (c) 2026
Maxime Golfier, under the MIT License.

## MI-GAN

The optional browser-side fallback uses the MI-GAN model from
[Picsart-AI-Research/MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN),
copyright (c) 2022 Picsart AI Research, under the MIT License. The model is
downloaded during development/build from the upstream Hugging Face repository
and verified against SHA-256
`6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b`.

## heic2any and libheif

HEIC/HEIF photos are decoded in the browser with
[heic2any](https://github.com/alexcorvi/heic2any) (MIT License), which bundles a
JavaScript build of [libheif](https://github.com/strukturag/libheif) (LGPL-3.0).
It is loaded only when a HEIC photo is opened.

## sharp and libvips

Server mode decodes and encodes images with [sharp](https://github.com/lovell/sharp)
(Apache-2.0), which uses prebuilt [libvips](https://github.com/libvips/libvips)
binaries (LGPL-3.0).

## Fonts

Cabinet Grotesk, Ranade and Gambarino are from [Fontshare](https://www.fontshare.com/) by the Indian Type Foundry, used under the ITF Free Font License and self-hosted in `src/app/fonts/`. Geist Mono is from Vercel under the SIL Open Font License 1.1, self-hosted through `next/font`.

## Demo photograph

`public/demo/timber-before.jpg` and `timber-after.jpg` are made from [Brettsperrholzkonstruktion.jpg](https://commons.wikimedia.org/wiki/File:Brettsperrholzkonstruktion.jpg) by RoterRolf (CC0, Wikimedia Commons), with a Gemini mark added for the demonstration.

The Telea and MI-GAN licenses permit use, copying, modification, and distribution subject to
their respective copyright and permission notices.

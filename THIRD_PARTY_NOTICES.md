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

## LaMa

The optional "Best quality" repair uses LaMa (big-lama) from
[advimman/lama](https://github.com/advimman/lama), copyright (c) 2021 Samsung
Research, under the Apache License 2.0, in the ONNX export published by
[OpenCV Zoo](https://huggingface.co/opencv/inpainting_lama) (Apache License 2.0).
The model is downloaded during development/build from that repository, pinned to
commit `aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f`, verified against SHA-256
`7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2`, and served
from this site. The browser loads it only when the user turns on "Best quality".

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

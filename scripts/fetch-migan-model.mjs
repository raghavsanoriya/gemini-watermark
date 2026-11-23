#!/usr/bin/env node
// Downloads the pinned AI fill models into public/vendor/models and verifies their SHA-256.
// - MI-GAN (28 MB): the default content-aware repair, used in the browser and on the server.
// - LaMa (92 MB): the optional "Best quality" repair, browser only, loaded only when chosen.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const models = [
  {
    name: 'MI-GAN',
    target: join(root, 'public', 'vendor', 'models', 'migan-pipeline-v2.onnx'),
    source: 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
    sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
  },
  {
    name: 'LaMa',
    target: join(root, 'public', 'vendor', 'models', 'lama-inpainting-2025jan.onnx'),
    // OpenCV Zoo export of big-lama, pinned to a commit.
    source: 'https://huggingface.co/opencv/inpainting_lama/resolve/aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f/inpainting_lama_2025jan.onnx',
    sha256: '7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2',
  },
];

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

for (const model of models) {
  try {
    if (digest(await readFile(model.target)) === model.sha256) {
      console.log(`${model.name} model already verified.`);
      continue;
    }
  } catch {
    // Download below.
  }

  console.log(`Downloading the pinned ${model.name} model…`);
  const response = await fetch(model.source);
  if (!response.ok) throw new Error(`${model.name} download failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== model.sha256) {
    throw new Error(`${model.name} checksum mismatch: expected ${model.sha256}, received ${actual}`);
  }
  await mkdir(dirname(model.target), { recursive: true });
  await writeFile(model.target, bytes);
  console.log(`${model.name} model downloaded and verified.`);
}

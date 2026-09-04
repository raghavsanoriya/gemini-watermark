#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'vendor', 'models', 'migan-pipeline-v2.onnx');
const source = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx';
const expectedSha256 = '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

try {
  if (digest(await readFile(target)) === expectedSha256) {
    console.log('MI-GAN model already verified.');
    process.exit(0);
  }
} catch {
  // Download below.
}

console.log('Downloading the pinned MI-GAN fallback model…');
const response = await fetch(source);
if (!response.ok) throw new Error(`MI-GAN download failed: ${response.status} ${response.statusText}`);
const bytes = Buffer.from(await response.arrayBuffer());
const actualSha256 = digest(bytes);
if (actualSha256 !== expectedSha256) {
  throw new Error(`MI-GAN checksum mismatch: expected ${expectedSha256}, received ${actualSha256}`);
}
await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log('MI-GAN model downloaded and verified.');

/*
 * Telea fast-marching inpainting adapted from maxgfr/unmark (MIT).
 * Original implementation copyright (c) 2026 Maxime Golfier.
 * See THIRD_PARTY_NOTICES.md.
 */

import type { PixelImageData } from './image-panorama-fallback';

const KNOWN = 0;
const BAND = 1;
const INSIDE = 2;
const INF = 1e6;
const RADIUS = 5;

interface Grid {
  width: number;
  height: number;
  flag: Uint8Array;
  time: Float32Array;
}

class Front {
  private readonly heap: { time: number; x: number; y: number }[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(time: number, x: number, y: number): void {
    this.heap.push({ time, x, y });
    let index = this.heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.heap[parent].time <= this.heap[index].time) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  pop(): { time: number; x: number; y: number } | undefined {
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.heap.length && this.heap[left].time < this.heap[smallest].time) smallest = left;
        if (right < this.heap.length && this.heap[right].time < this.heap[smallest].time) smallest = right;
        if (smallest === index) break;
        [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
        index = smallest;
      }
    }
    return first;
  }
}

const pixelIndex = (width: number, x: number, y: number): number => y * width + x;
const rgbaIndex = (width: number, x: number, y: number): number => pixelIndex(width, x, y) * 4;

function isInside(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

function solve(grid: Grid, x1: number, y1: number, x2: number, y2: number): number {
  const firstKnown = isInside(grid, x1, y1) && grid.flag[pixelIndex(grid.width, x1, y1)] !== INSIDE;
  const secondKnown = isInside(grid, x2, y2) && grid.flag[pixelIndex(grid.width, x2, y2)] !== INSIDE;
  if (!firstKnown && !secondKnown) return INF;
  if (!secondKnown) return 1 + grid.time[pixelIndex(grid.width, x1, y1)];
  if (!firstKnown) return 1 + grid.time[pixelIndex(grid.width, x2, y2)];

  const first = grid.time[pixelIndex(grid.width, x1, y1)];
  const second = grid.time[pixelIndex(grid.width, x2, y2)];
  const discriminant = 2 - (first - second) ** 2;
  if (discriminant > 0) {
    const root = Math.sqrt(discriminant);
    const lower = (first + second - root) / 2;
    if (lower >= first && lower >= second) return lower;
    const upper = (first + second + root) / 2;
    if (upper >= first && upper >= second) return upper;
  }
  return 1 + Math.min(first, second);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function estimate(image: PixelImageData, grid: Grid, x: number, y: number): [number, number, number] {
  const center = pixelIndex(grid.width, x, y);
  let normalX = 0;
  let normalY = 0;
  if (isInside(grid, x + 1, y) && isInside(grid, x - 1, y)) {
    normalX = (grid.time[center + 1] - grid.time[center - 1]) / 2;
  }
  if (isInside(grid, x, y + 1) && isInside(grid, x, y - 1)) {
    normalY = (grid.time[center + grid.width] - grid.time[center - grid.width]) / 2;
  }

  const accumulated = [0, 0, 0];
  let totalWeight = 0;
  for (let dy = -RADIUS; dy <= RADIUS; dy += 1) {
    const sampleY = y + dy;
    if (sampleY < 0 || sampleY >= grid.height) continue;
    for (let dx = -RADIUS; dx <= RADIUS; dx += 1) {
      const sampleX = x + dx;
      if (sampleX < 0 || sampleX >= grid.width) continue;
      const samplePixel = pixelIndex(grid.width, sampleX, sampleY);
      if (grid.flag[samplePixel] === INSIDE) continue;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared === 0 || distanceSquared > RADIUS * RADIUS) continue;

      const distance = Math.sqrt(distanceSquared);
      const direction = Math.abs((-dx * normalX - dy * normalY) / distance) + 1e-6;
      const distanceWeight = 1 / distanceSquared;
      const levelWeight = 1 / (1 + Math.abs(grid.time[samplePixel] - grid.time[center]));
      const weight = direction * distanceWeight * levelWeight;
      const sample = rgbaIndex(image.width, sampleX, sampleY);

      for (let channel = 0; channel < 3; channel += 1) {
        let value = image.data[sample + channel];
        if (
          sampleX > 0 && sampleX + 1 < grid.width &&
          grid.flag[samplePixel - 1] !== INSIDE && grid.flag[samplePixel + 1] !== INSIDE
        ) {
          const left = rgbaIndex(image.width, sampleX - 1, sampleY) + channel;
          const right = rgbaIndex(image.width, sampleX + 1, sampleY) + channel;
          value += ((image.data[right] - image.data[left]) / 2) * -dx;
        }
        if (
          sampleY > 0 && sampleY + 1 < grid.height &&
          grid.flag[samplePixel - grid.width] !== INSIDE &&
          grid.flag[samplePixel + grid.width] !== INSIDE
        ) {
          const up = rgbaIndex(image.width, sampleX, sampleY - 1) + channel;
          const down = rgbaIndex(image.width, sampleX, sampleY + 1) + channel;
          value += ((image.data[down] - image.data[up]) / 2) * -dy;
        }
        accumulated[channel] += weight * value;
      }
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return [0, 0, 0];
  return [
    clamp(accumulated[0] / totalWeight),
    clamp(accumulated[1] / totalWeight),
    clamp(accumulated[2] / totalWeight),
  ];
}

/** Fill non-zero mask pixels while preserving alpha and every unmasked pixel. */
export function teleaInpaint(image: PixelImageData, mask: Uint8Array): PixelImageData {
  const output: PixelImageData = {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
  const grid: Grid = {
    width: image.width,
    height: image.height,
    flag: new Uint8Array(image.width * image.height),
    time: new Float32Array(image.width * image.height),
  };

  let holes = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    grid.flag[index] = INSIDE;
    grid.time[index] = INF;
    holes += 1;
  }
  if (holes === 0 || holes === mask.length) return output;

  const front = new Front();
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const current = pixelIndex(grid.width, x, y);
      if (grid.flag[current] !== INSIDE) continue;
      for (const [dx, dy] of directions) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (!isInside(grid, nextX, nextY)) continue;
        const next = pixelIndex(grid.width, nextX, nextY);
        if (grid.flag[next] === KNOWN) {
          grid.flag[next] = BAND;
          grid.time[next] = 0;
          front.push(0, nextX, nextY);
        }
      }
    }
  }

  while (front.size > 0) {
    const current = front.pop();
    if (!current) break;
    grid.flag[pixelIndex(grid.width, current.x, current.y)] = KNOWN;
    for (const [dx, dy] of directions) {
      const nextX = current.x + dx;
      const nextY = current.y + dy;
      if (!isInside(grid, nextX, nextY)) continue;
      const next = pixelIndex(grid.width, nextX, nextY);
      if (grid.flag[next] !== INSIDE) continue;

      const time = Math.min(
        solve(grid, nextX - 1, nextY, nextX, nextY - 1),
        solve(grid, nextX + 1, nextY, nextX, nextY - 1),
        solve(grid, nextX - 1, nextY, nextX, nextY + 1),
        solve(grid, nextX + 1, nextY, nextX, nextY + 1),
      );
      grid.time[next] = time;
      const [red, green, blue] = estimate(output, grid, nextX, nextY);
      const destination = rgbaIndex(output.width, nextX, nextY);
      output.data[destination] = red;
      output.data[destination + 1] = green;
      output.data[destination + 2] = blue;
      grid.flag[next] = BAND;
      front.push(time, nextX, nextY);
    }
  }

  return output;
}

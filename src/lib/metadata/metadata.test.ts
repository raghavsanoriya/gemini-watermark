import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { scanMetadata } from './scan';
import { orientationTiff, stripMetadata, UnsupportedContainerError } from './strip';

const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmp:CreatorTool="Adobe Firefly" Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

const EXIF = {
  IFD0: { Make: 'Pixel', Model: '9 Pro', Software: 'HDR+ 1.0' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '0/1 7/1 0/1' },
};

async function base(width = 48, height = 32) {
  // Non-uniform pixels so a byte-identical decode means something.
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + (i >> 5) * 11) & 0xff;
  return sharp(raw, { raw: { width, height, channels: 3 } });
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  out.set([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
  out.set(payload, 4);
  return out;
}

const text = (value: string) => new TextEncoder().encode(value);

function insertAfterSoi(jpeg: Uint8Array, ...segments: Uint8Array[]): Uint8Array {
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  // CRC is not checked by our parser; sharp ignores bad CRCs on ancillary chunks only after strip removes them.
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  return out;
}

function insertBeforeIend(png: Uint8Array, ...chunks: Uint8Array[]): Uint8Array {
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), ...chunks, png.subarray(iend)]);
}

async function rawPixels(bytes: Uint8Array) {
  return sharp(bytes).raw().toBuffer();
}

describe('scanMetadata', () => {
  it('reports EXIF, GPS, XMP, C2PA, comment and data after the image in a JPEG', async () => {
    const jpeg = await (await base()).jpeg().withExif(EXIF).withXmp(XMP).toBuffer();
    const jumbf = segment(0xeb, Buffer.concat([text('JP'), Buffer.alloc(6), text('jumbc2pa claim_generator Adobe_Firefly')]));
    const withExtras = Buffer.concat([insertAfterSoi(jpeg, jumbf, segment(0xfe, text('made with care'))), text('trailing secret')]);
    const report = scanMetadata(withExtras);
    expect(report.container).toBe('jpeg');
    expect(report.found).toEqual(expect.arrayContaining(['exif', 'gps', 'xmp', 'c2pa', 'comment', 'trailing-data']));
    expect(report.details.camera).toBe('Pixel 9 Pro');
    expect(report.details.software).toBe('HDR+ 1.0');
    expect(report.details.creatorTool).toBe('Adobe Firefly');
    expect(report.details.digitalSourceType).toBe('trainedAlgorithmicMedia');
    expect(report.details.generator).toBe('Adobe Firefly');
  });

  it('finds Stable Diffusion parameters in PNG text chunks', async () => {
    const png = await (await base()).png().toBuffer();
    const params = pngChunk('tEXt', text('parameters\0a portrait\nSteps: 30, Sampler: Euler a, CFG scale: 7, Seed: 1'));
    const report = scanMetadata(insertBeforeIend(png, params, pngChunk('caBX', text('jumb c2pa'))));
    expect(report.found).toEqual(expect.arrayContaining(['ai-parameters', 'c2pa']));
    expect(report.details.generator).toBeUndefined();
  });

  it('does not name a generator from ordinary editing metadata', async () => {
    const lightroom = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:aux="http://ns.adobe.com/exif/1.0/aux/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" aux:ImageNumber="4123" xmp:CreatorTool="Adobe Lightroom Classic 14.0"/></rdf:RDF></x:xmpmeta>';
    const jpeg = await (await base()).jpeg().withExifMerge({ IFD0: { Software: 'Adobe Lightroom', ImageDescription: 'Gemini and Firefly at dusk' } }).withXmp(lightroom).toBuffer();
    const report = scanMetadata(jpeg);
    expect(report.found).toEqual(expect.arrayContaining(['exif', 'xmp']));
    expect(report.details.generator).toBeUndefined();
    expect(report.details.creatorTool).toBe('Adobe Lightroom Classic 14.0');
  });

  it('reports unknown PNG chunks the stripper would drop', async () => {
    const png = await (await base()).png().toBuffer();
    expect(scanMetadata(insertBeforeIend(png, pngChunk('vpAg', new Uint8Array(9)))).found).toEqual(['vendor']);
  });

  it('reports a clean file as clean', async () => {
    const jpeg = await (await base()).jpeg().toBuffer();
    expect(scanMetadata(jpeg).found).toEqual([]);
  });
});

describe('stripMetadata', () => {
  it('strips a JPEG losslessly, keeping ICC and orientation, dropping data after the image', async () => {
    // sharp writes Orientation only through withMetadata; withExif drops it.
    const jpeg = await (await base()).jpeg().withMetadata({ orientation: 6 }).withExifMerge(EXIF).withXmp(XMP).withIccProfile('p3').toBuffer();
    const jumbf = segment(0xeb, Buffer.concat([text('JP'), Buffer.alloc(6), text('jumbc2pa')]));
    const iptc = segment(0xed, text('Photoshop 3.0\u00008BIM\u0004\u0004'));
    const decorated = Buffer.concat([insertAfterSoi(jpeg, jumbf, iptc, segment(0xfe, text('note'))), await (await base(8, 8)).jpeg().withExif(EXIF).toBuffer()]);

    const { bytes, mimeType } = stripMetadata(decorated);
    expect(mimeType).toBe('image/jpeg');
    const before = await sharp(decorated).metadata();
    const after = await sharp(bytes).metadata();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.orientation).toBe(6);
    expect(after.icc?.equals(before.icc!)).toBe(true);
    // The only EXIF left is the bare orientation block.
    expect(after.exif?.subarray(6).equals(Buffer.from(orientationTiff(6)))).toBe(true);
    expect((await rawPixels(bytes)).equals(await rawPixels(decorated))).toBe(true);
    expect(bytes.length).toBeLessThan(decorated.length);

    const report = scanMetadata(bytes);
    expect(report.found).toEqual([]);
    expect(report.details.orientationOnly).toBe(true);
    expect(report.details.orientation).toBe(6);
  });

  it('strips a progressive JPEG with no orientation to no EXIF at all', async () => {
    const jpeg = await (await base(64, 64)).jpeg({ progressive: true }).withExif(EXIF).toBuffer();
    const { bytes } = stripMetadata(jpeg);
    const after = await sharp(bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect((await rawPixels(bytes)).equals(await rawPixels(jpeg))).toBe(true);
  });

  it('strips a PNG losslessly, keeping colour chunks', async () => {
    const png = await (await base()).png().withExif(EXIF).withXmp(XMP).withIccProfile('p3').toBuffer();
    const decorated = Buffer.concat([
      insertBeforeIend(png, pngChunk('tEXt', text('parameters\0Steps: 20, Sampler: Euler')), pngChunk('caBX', text('jumb c2pa'))),
      text('appended'),
    ]);
    const { bytes } = stripMetadata(decorated);
    const before = await sharp(png).metadata();
    const after = await sharp(bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc?.equals(before.icc!)).toBe(true);
    expect((await rawPixels(bytes)).equals(await rawPixels(png))).toBe(true);
    expect(scanMetadata(bytes).found).toEqual([]);
  });

  it('keeps PNG orientation as a lone eXIf chunk before the image data', async () => {
    const png = await (await base()).png().withMetadata({ orientation: 8 }).withExifMerge({ IFD0: { Software: 'Gemini' } }).toBuffer();
    const { bytes } = stripMetadata(png);
    const order = Buffer.from(bytes).toString('latin1');
    expect(order.indexOf('eXIf')).toBeGreaterThan(0);
    expect(order.indexOf('eXIf')).toBeLessThan(order.indexOf('IDAT'));
    expect((await sharp(bytes).metadata()).orientation).toBe(8);
    expect(scanMetadata(bytes).details.orientationOnly).toBe(true);
  });

  it('strips a WebP and fixes its header flags and size', async () => {
    const webp = await (await base()).webp({ lossless: true }).withExif(EXIF).withXmp(XMP).withIccProfile('p3').toBuffer();
    const { bytes } = stripMetadata(webp);
    const after = await sharp(bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeDefined();
    expect(Buffer.from(bytes).readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes[20] & 0x0c).toBe(0); // VP8X EXIF and XMP flags cleared
    expect((await rawPixels(bytes)).equals(await rawPixels(webp))).toBe(true);
    expect(scanMetadata(bytes).found).toEqual([]);
  });

  it('refuses files that are not JPEG, PNG or WebP', () => {
    expect(() => stripMetadata(text('GIF89a'))).toThrow(UnsupportedContainerError);
  });
});

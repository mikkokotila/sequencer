/**
 * Kit exporter — bundles all loaded samples into a ZIP for download.
 *
 * Creates a ZIP containing the original sample files (from SampleData.data)
 * with their original names. Folder name = "{songName}-bundle".
 * Zero external dependencies — uses a minimal ZIP builder for stored entries.
 */

import { currentSongName } from './song';
import { drumSampleData, melSampleData, vocalSampleData } from './song';
import { DRUMS_CFG, MEL_CFG } from '../config';

// ═══════════════════════════════════════════
//  Minimal ZIP builder (stored, no compression)
// ═══════════════════════════════════════════

interface ZipEntry {
  name: string; // path inside ZIP (e.g. "my-bundle/kick.wav")
  data: Uint8Array;
}

/** CRC-32 lookup table. */
const crcTable: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable.push(c);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, offset: number, val: number): void {
  view.setUint16(offset, val, true);
}

function writeU32(view: DataView, offset: number, val: number): void {
  view.setUint32(offset, val, true);
}

function buildZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();

  // Pre-compute sizes
  interface LocalHeader {
    nameBytes: Uint8Array;
    offset: number;
    crc: number;
  }

  const headers: LocalHeader[] = [];
  let localOffset = 0;
  const localParts: BlobPart[] = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const headerSize = 30 + nameBytes.length;

    // Local file header
    const lh = new ArrayBuffer(30);
    const lv = new DataView(lh);
    writeU32(lv, 0, 0x04034b50); // signature
    writeU16(lv, 4, 20); // version needed
    writeU16(lv, 6, 0); // flags
    writeU16(lv, 8, 0); // compression = stored
    writeU16(lv, 10, 0); // mod time
    writeU16(lv, 12, 0); // mod date
    writeU32(lv, 14, crc);
    writeU32(lv, 18, entry.data.length); // compressed size
    writeU32(lv, 22, entry.data.length); // uncompressed size
    writeU16(lv, 26, nameBytes.length);
    writeU16(lv, 28, 0); // extra field length

    headers.push({ nameBytes, offset: localOffset, crc });
    localParts.push(lh, nameBytes as unknown as BlobPart, entry.data as unknown as BlobPart);
    localOffset += headerSize + entry.data.length;
  }

  // Central directory
  const centralParts: BlobPart[] = [];
  let centralSize = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const h = headers[i]!;
    const cdh = new ArrayBuffer(46);
    const cv = new DataView(cdh);
    writeU32(cv, 0, 0x02014b50); // central dir signature
    writeU16(cv, 4, 20); // version made by
    writeU16(cv, 6, 20); // version needed
    writeU16(cv, 8, 0); // flags
    writeU16(cv, 10, 0); // compression = stored
    writeU16(cv, 12, 0); // mod time
    writeU16(cv, 14, 0); // mod date
    writeU32(cv, 16, h.crc);
    writeU32(cv, 20, entry.data.length); // compressed
    writeU32(cv, 24, entry.data.length); // uncompressed
    writeU16(cv, 28, h.nameBytes.length);
    writeU16(cv, 30, 0); // extra field length
    writeU16(cv, 32, 0); // comment length
    writeU16(cv, 34, 0); // disk number
    writeU16(cv, 36, 0); // internal attrs
    writeU32(cv, 38, 0); // external attrs
    writeU32(cv, 42, h.offset); // local header offset

    centralParts.push(cdh);
    centralParts.push(new Uint8Array(h.nameBytes).buffer);
    centralSize += 46 + h.nameBytes.length;
  }

  // End of central directory
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  writeU32(ev, 0, 0x06054b50); // signature
  writeU16(ev, 4, 0); // disk number
  writeU16(ev, 6, 0); // central dir disk
  writeU16(ev, 8, entries.length); // entries on disk
  writeU16(ev, 10, entries.length); // total entries
  writeU32(ev, 12, centralSize);
  writeU32(ev, 16, localOffset); // central dir offset
  writeU16(ev, 20, 0); // comment length

  return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}

// ═══════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════

/** Export all loaded samples as a ZIP download. */
export function exportKit(): void {
  const entries: ZipEntry[] = [];
  const songName = currentSongName || 'Untitled';
  const folderName = songName.replace(/[^a-zA-Z0-9_\- ]/g, '') + '-bundle';

  // Drum samples
  for (let i = 0; i < DRUMS_CFG.length; i++) {
    const sd = drumSampleData[i];
    if (sd?.data) {
      entries.push({
        name: `${folderName}/${sd.name}`,
        data: new Uint8Array(sd.data),
      });
    }
  }

  // Melody samples
  for (let i = 0; i < MEL_CFG.length; i++) {
    const sd = melSampleData[i];
    if (sd?.data) {
      entries.push({
        name: `${folderName}/${sd.name}`,
        data: new Uint8Array(sd.data),
      });
    }
  }

  // Vocal sample
  if (vocalSampleData?.data) {
    entries.push({
      name: `${folderName}/${vocalSampleData.name}`,
      data: new Uint8Array(vocalSampleData.data),
    });
  }

  if (entries.length === 0) {
    // Nothing to export
    return;
  }

  const blob = buildZip(entries);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

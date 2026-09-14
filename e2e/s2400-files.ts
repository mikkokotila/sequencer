// Independent readers: these never import the production serializers.
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

export function readZip(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    expect(bytes.readUInt16LE(offset + 8)).toBe(0);
    const size = bytes.readUInt32LE(offset + 18);
    const length = bytes.readUInt16LE(offset + 26);
    const extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 30, offset + 30 + length);
    expect(name).not.toMatch(/(^\/|\.\.|\\)/);
    expect(files.has(name)).toBe(false);
    const start = offset + 30 + length + extra;
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(bytes.readUInt32LE(offset + 14));
    files.set(name, data);
    offset = start + size;
  }
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  expect(bytes.readUInt16LE(end + 10)).toBe(files.size);
  expect(bytes.readUInt32LE(end + 16)).toBe(offset);
  return files;
}
export interface Record { id: number; type: number; value: number | Buffer }
export function records(bytes: Buffer): Record[] {
  const result: Record[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const type = bytes.readUInt8(offset), id = bytes.readUInt16LE(offset + 1);
    expect([1, 2, 3]).toContain(type);
    const n = type === 2 ? bytes.readInt32LE(offset + 3) : bytes.readUInt32LE(offset + 3);
    offset += 7;
    const value = type === 3 ? bytes.subarray(offset, offset + n) : n;
    if (type === 3) { expect((value as Buffer).length).toBe(n); offset += n; }
    result.push({ type, id, value });
  }
  expect(offset).toBe(bytes.length);
  return result;
}
export function field(rs: Record[], id: number): number { return rs.find(r => r.id === id)!.value as number; }
export function blob(rs: Record[], id: number): Buffer { return rs.find(r => r.id === id)!.value as Buffer; }
export function blocks(rs: Record[], start: number): Record[][] {
  const result: Record[][] = [];
  for (const r of rs) {
    if (r.id === start) result.push([]);
    result.at(-1)?.push(r);
  }
  return result;
}
export function events(rs: Record[]) {
  const bytes = blob(rs, 23);
  expect(bytes.length).toBe(field(rs, 21) * 4);
  const result: { tick: number; track: number; parameters: number[] }[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const word = bytes.readUInt32LE(offset);
    assert.equal(word % 2, 1);
    assert.equal((word >>> 7) & 15, 8);
    const count = (word >>> 11) & 31;
    const parameters = Array.from({ length: count }, (_, i) => bytes.readUInt32LE(offset + 4 + i * 4));
    parameters.forEach(parameter => assert.equal(parameter & 255, 8));
    result.push({ tick: word >>> 16, track: (word >>> 1) & 63, parameters });
    offset += (count + 1) * 4;
  }
  return result;
}

/** Check the extracted project in isolation: three sidecars plus every KIT sample. */
export function expectCompleteS2400Project(files: Map<string, Buffer>): void {
  const projectPaths = [...files.keys()].filter(name => name.startsWith('PROJECTS/'));
  const sequences = projectPaths.filter(name => name.endsWith('.S24'));
  expect(sequences).toHaveLength(1);
  const base = sequences[0]!.slice(0, -4);
  const folder = base.slice(0, base.lastIndexOf('/') + 1);
  const kitPath = `${base}.KIT`, mapPath = `${folder}MIDItracks.map`;
  expect(files.has(kitPath)).toBe(true); expect(files.has(mapPath)).toBe(true);
  const kit = records(files.get(kitPath)!);
  const samples = blocks(kit, 2).map(track => `${folder}${blob(track, 10).toString('ascii').split('\0')[0]}.wav`);
  expect(samples).toHaveLength(field(kit, 1));
  expect(projectPaths.sort()).toEqual([sequences[0]!, kitPath, mapPath, ...samples].sort());
  samples.forEach(name => {
    const wav = files.get(name)!;
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length);
    expect(wav.readUInt32LE(40)).toBeGreaterThan(0);
  });
  // Hardware-saved Project002 map, normalizing only line endings/trailing whitespace.
  const normalized = files.get(mapPath)!.toString('ascii').replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n');
  expect(createHash('sha256').update(normalized).digest('hex'))
    .toBe('9991f5cea1cf92afa43308fc6e90bc9c1294e70f4124cf3fde5c99b7a7e6281d');
}

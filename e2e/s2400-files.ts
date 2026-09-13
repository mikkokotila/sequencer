// Independent readers: these never import the production serializers.
import { expect } from '@playwright/test';
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
    expect(word % 2).toBe(1);
    expect((word >>> 7) & 15).toBe(8);
    const count = (word >>> 11) & 31;
    const parameters = Array.from({ length: count }, (_, i) => bytes.readUInt32LE(offset + 4 + i * 4));
    parameters.forEach(parameter => expect(parameter & 255).toBe(8));
    result.push({ tick: word >>> 16, track: (word >>> 1) & 63, parameters });
    offset += (count + 1) * 4;
  }
  return result;
}

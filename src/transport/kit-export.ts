/** Export the original sample bytes for every loaded track, without rendering or effects. */
import { currentSongName, drumSampleData, melSampleData, vocalSampleData } from './song';
import { buildStoreZip, type ZipEntry } from './zip';
import { exportFilename, saveExportFile, type SavedExport } from './export-file';

/** Safe, bounded basenames; equivalent names also collide on case-insensitive filesystems. */
function sampleName(raw: string, used: Set<string>): string {
  const base = exportFilename(raw.split(/[/\\]/).pop() ?? '', '');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  let name = base;
  let suffix = 2;
  while (used.has(name.normalize('NFC').toLowerCase())) {
    name = `${stem}_${suffix++}${extension}`;
  }
  used.add(name.normalize('NFC').toLowerCase());
  return name;
}

/** Snapshot all loaded drums, synths and vocal samples, then explicitly save their ZIP. */
export async function exportKit(): Promise<SavedExport> {
  const folder = exportFilename(currentSongName, '-bundle');
  const used = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const sample of [...drumSampleData, ...melSampleData, vocalSampleData]) {
    if (!sample?.data.byteLength) continue;
    entries.push({
      name: `${folder}/${sampleName(sample.name, used)}`,
      data: new Uint8Array(sample.data),
    });
  }
  if (!entries.length) throw new Error('Load at least one sample before exporting a kit.');
  // Build before the first await: edits during the save cannot alter this export.
  const zip = buildStoreZip(entries);
  return saveExportFile(
    new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }),
    `${folder}.zip`,
    'download',
  );
}

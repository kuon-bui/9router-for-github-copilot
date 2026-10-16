export const MAX_MODEL_OUTPUT_BYTES = 64 * 1024;
export const MAX_FILE_READ_LINES = 2000;
export const MAX_FILE_READ_BYTES = 256 * 1024;
export const MAX_LIST_DIRECTORY_ENTRIES = 1000;
export const MAX_SEARCH_MATCHES = 200;
export const MAX_SEARCH_FILES = 20000;
export const MAX_FILE_MUTATION_BYTES = 1024 * 1024;

export function truncateOutput(text: string, maxBytes = MAX_MODEL_OUTPUT_BYTES): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const totalBytes = bytes.byteLength;

  if (totalBytes <= maxBytes) {
    return text;
  }

  const markerPrefix = '\n[... truncated ';
  const markerSuffix = ' bytes ...]\n';
  const estDropped = totalBytes - maxBytes;
  const markerEst = encoder.encode(`${markerPrefix}${estDropped}${markerSuffix}`).byteLength;
  const budget = Math.max(0, maxBytes - markerEst);
  const half = Math.floor(budget / 2);

  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let head = buf.subarray(0, half).toString('utf8');
  let tail = buf.subarray(totalBytes - half).toString('utf8');

  if (head.endsWith('\uFFFD')) {
    head = head.slice(0, -1);
  }
  if (tail.startsWith('\uFFFD')) {
    tail = tail.slice(1);
  }

  const headBytes = Buffer.byteLength(head, 'utf8');
  const tailBytes = Buffer.byteLength(tail, 'utf8');
  const droppedBytes = totalBytes - (headBytes + tailBytes);

  return `${head}${markerPrefix}${droppedBytes}${markerSuffix}${tail}`;
}

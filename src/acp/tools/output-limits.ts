export const MAX_MODEL_OUTPUT_BYTES = 64 * 1024;
export const MAX_FILE_READ_LINES = 2000;
export const MAX_FILE_READ_BYTES = 256 * 1024;
export const MAX_LIST_DIRECTORY_ENTRIES = 1000;
export const MAX_SEARCH_MATCHES = 200;
export const MAX_SEARCH_FILES = 20000;
export const MAX_FILE_MUTATION_BYTES = 1024 * 1024;

export function truncateOutput(text: string, maxBytes = MAX_MODEL_OUTPUT_BYTES): string {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(text).byteLength;

  if (totalBytes <= maxBytes) {
    return text;
  }

  const markerEstimate = 32;
  const budget = Math.max(10, maxBytes - markerEstimate);
  const half = Math.floor(budget / 2);
  const head = text.slice(0, half);
  const tail = text.slice(text.length - half);
  const droppedBytes = totalBytes - (encoder.encode(head).byteLength + encoder.encode(tail).byteLength);

  return `${head}\n[... truncated ${droppedBytes} bytes ...]\n${tail}`;
}

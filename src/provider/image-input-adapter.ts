import { Buffer } from 'node:buffer';
import type { RouterResponseInputImage } from '@/types/router-contract';

export interface HostImageDataPart {
  mimeType: string;
  data: Uint8Array;
}

export function isHostImageDataPart(part: unknown): part is HostImageDataPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'mimeType' in part &&
    typeof part.mimeType === 'string' &&
    part.mimeType.startsWith('image/') &&
    'data' in part &&
    part.data instanceof Uint8Array
  );
}

export function createRouterImagePart(part: HostImageDataPart): RouterResponseInputImage {
  return {
    type: 'input_image',
    image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`
  };
}

export function hasImageParts(content: string | readonly unknown[]): boolean {
  return countImageParts(content) > 0;
}

export function countImageParts(content: string | readonly unknown[]): number {
  return typeof content === 'string' ? 0 : content.filter(isHostImageDataPart).length;
}

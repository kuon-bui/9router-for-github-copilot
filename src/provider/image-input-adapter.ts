import { Buffer } from 'node:buffer';
import type { RouterContentPart } from '../types/router-contract';

export interface HostImageDataPart {
  mimeType: string;
  data: Uint8Array;
}

function isHostDataPart(part: unknown): part is HostImageDataPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'mimeType' in part &&
    typeof part.mimeType === 'string' &&
    'data' in part &&
    part.data instanceof Uint8Array
  );
}

export function isHostImageDataPart(part: unknown): part is HostImageDataPart {
  return isHostDataPart(part) && part.mimeType.startsWith('image/');
}

export function isHostNonImageDataPart(part: unknown): part is HostImageDataPart {
  return isHostDataPart(part) && !part.mimeType.startsWith('image/');
}

export function createRouterImagePart(part: HostImageDataPart): RouterContentPart {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`
    }
  };
}

export function hasImageParts(content: string | readonly unknown[]): boolean {
  return countImageParts(content) > 0;
}

export function countImageParts(content: string | readonly unknown[]): number {
  return typeof content === 'string' ? 0 : content.filter(isHostImageDataPart).length;
}

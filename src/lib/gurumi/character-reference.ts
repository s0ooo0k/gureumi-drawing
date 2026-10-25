import { GURUMI_REFERENCE_MASKS } from './reference-mask-data';
import { buildGurumiReferenceModelFromMask, GURUMI_SCORE_GRID_SIZE, type GurumiReferenceModel } from './similarity';

const models = new Map<string, GurumiReferenceModel>();
export function getGurumiCharacterReference(id: string) {
  if (!Object.prototype.hasOwnProperty.call(GURUMI_REFERENCE_MASKS, id)) throw new Error('Unknown Gurumi character.');
  const cached = models.get(id);
  if (cached) return cached;
  const bytes = globalThis.atob(GURUMI_REFERENCE_MASKS[id as keyof typeof GURUMI_REFERENCE_MASKS]);
  const mask = new Uint8Array(GURUMI_SCORE_GRID_SIZE ** 2);
  for (let i = 0; i < mask.length; i++) mask[i] = (bytes.charCodeAt(i >> 3) >> (i & 7)) & 1;
  const model = buildGurumiReferenceModelFromMask(mask, 'adaptive');
  models.set(id, model);
  return model;
}

import { AppError } from '@/http/errors.js';
import { KIND_BY_EXTENSION, MAX_FILE_NAME_LENGTH } from '../files.constants.js';
import type { FileKindType } from '../files.types.js';

const invalidName = () => new AppError('VALIDATION_FAILED', [{ path: 'name', code: 'invalid_name' }]);

/**
 * The stored name of an upload and its kind. Path parts and control characters are removed and the text is
 * normalized to NFC, so `../../etc/passwd.txt` becomes `passwd.txt`; an extension is required, and the kind it
 * names must be allowed. The name is only ever a label: the storage key never uses it.
 */
export function cleanFileName(raw: string): { name: string; kind: FileKindType } {
  const lastPart = raw.normalize('NFC').split(/[/\\]/).at(-1) ?? '';
  const name = lastPart.replace(/\p{Cc}/gu, '').trim();
  const dot = name.lastIndexOf('.');
  if (Array.from(name).length === 0 || Array.from(name).length > MAX_FILE_NAME_LENGTH || dot < 1 || dot === name.length - 1) {
    throw invalidName();
  }
  const extension = name.slice(dot + 1).toLowerCase();
  const kind = (KIND_BY_EXTENSION as Record<string, FileKindType | undefined>)[extension];
  if (!kind) {
    throw new AppError('FILE_TYPE_NOT_ALLOWED');
  }
  return { name, kind };
}

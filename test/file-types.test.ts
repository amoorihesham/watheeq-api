import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/http/errors.js';
import type { FileKindType } from '../src/modules/files/files.types.js';
import { createUploadInspector } from '../src/modules/files/shared/inspector.js';
import { fixture } from './helpers/files.js';
import { plainZip, wordContentTypesFirst, wordContentTypesLast, zipOf } from './helpers/zip.js';

// Phase 5.5 spec, 4.3 (principle 12): can `file-type` tell Word, Excel, and PowerPoint files apart from a stream
// prefix, without buffering the whole file? These tests feed real files through the same inspector the upload uses,
// in small chunks like a network does.

function chunked(bytes: Buffer, size: number): Readable {
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }
  return Readable.from(chunks, { objectMode: false });
}

/** Runs a body through the inspector; resolves with the outcome the upload would act on. */
async function inspect(kind: FileKindType, bytes: Buffer, { declared = bytes.length, chunkSize = 1400 } = {}): Promise<'accepted' | string> {
  const inspector = createUploadInspector(kind, declared);
  try {
    let received = 0;
    for await (const chunk of inspector.measure(chunked(bytes, chunkSize))) {
      received += chunk.length;
    }
    return received === bytes.length ? 'accepted' : 'short';
  } catch (err) {
    if (err instanceof AppError) {
      return err.details?.[0]?.code ?? err.code;
    }
    throw err;
  }
}

describe('real files, streamed in chunks', () => {
  it.each([
    ['pdf', 'contract.pdf'],
    ['docx', 'contract.docx'],
    ['xlsx', 'sheet.xlsx'],
    ['pptx', 'deck.pptx'],
    ['png', 'contract.png'],
    ['jpg', 'contract.jpg'],
  ] as const)('recognizes %s from %s', async (kind, name) => {
    expect(await inspect(kind, fixture(name))).toBe('accepted');
  });

  it('tells the three Office kinds apart: each fixture is refused under the other two names', async () => {
    const files = { docx: 'contract.docx', xlsx: 'sheet.xlsx', pptx: 'deck.pptx' } as const;
    for (const [kind, name] of Object.entries(files)) {
      for (const other of ['docx', 'xlsx', 'pptx'] as const) {
        if (other !== kind) {
          expect(await inspect(other, fixture(name))).toBe('FILE_TYPE_NOT_ALLOWED');
        }
      }
    }
  });

  it('recognizes a file written as LibreOffice writes it, with [Content_Types].xml last', async () => {
    // contract.docx comes from LibreOffice: its content types entry is the last of the archive.
    const names = fixture('contract.docx');
    expect(names.indexOf('[Content_Types].xml')).toBeGreaterThan(names.indexOf('word/document.xml'));
    expect(await inspect('docx', names)).toBe('accepted');
  });

  it('reads a prefix, not the file: a Word file larger than the prefix is recognized with the content types first or last', async () => {
    const mib = 1024 * 1024;
    expect(await inspect('docx', wordContentTypesFirst(3 * mib), { chunkSize: 64 * 1024 })).toBe('accepted');
    expect(await inspect('docx', wordContentTypesLast(3 * mib), { chunkSize: 64 * 1024 })).toBe('accepted');
    // An archive whose first entry is a 2 MB attachment is still a Word file by the name of that entry.
    const attachmentFirst = zipOf([
      { name: 'word/media/scan.bin', data: Buffer.alloc(2 * mib, 'x') },
      { name: 'word/document.xml', data: Buffer.from('<w/>') },
    ]);
    expect(await inspect('docx', attachmentFirst, { chunkSize: 64 * 1024 })).toBe('accepted');
  });

  it('refuses an ordinary ZIP archive under any Office name', async () => {
    for (const kind of ['docx', 'xlsx', 'pptx'] as const) {
      expect(await inspect(kind, plainZip())).toBe('FILE_TYPE_NOT_ALLOWED');
    }
  });
});

describe('plain text', () => {
  it('accepts UTF-8 split across chunks, and refuses NUL bytes and invalid UTF-8 wherever they are', async () => {
    const arabic = Buffer.from('عقد التوريد بين الطرفين '.repeat(200));
    expect(await inspect('txt', arabic, { chunkSize: 7 })).toBe('accepted');
    const lateNul = Buffer.concat([Buffer.alloc(5000, 'a'), Buffer.from([0]), Buffer.alloc(10, 'b')]);
    expect(await inspect('txt', lateNul)).toBe('FILE_TYPE_NOT_ALLOWED');
    const lateInvalid = Buffer.concat([Buffer.alloc(5000, 'a'), Buffer.from([0xc3, 0x28])]);
    expect(await inspect('txt', lateInvalid)).toBe('FILE_TYPE_NOT_ALLOWED');
    const cutCharacter = Buffer.concat([Buffer.alloc(100, 'a'), Buffer.from('ع').subarray(0, 1)]);
    expect(await inspect('txt', cutCharacter)).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('refuses a file with a binary signature under .txt', async () => {
    expect(await inspect('txt', fixture('contract.png'))).toBe('FILE_TYPE_NOT_ALLOWED');
  });
});

describe('declared size', () => {
  it('refuses a body longer than declared as soon as it runs past, and one that ends short', async () => {
    const pdf = fixture('contract.pdf');
    expect(await inspect('pdf', pdf, { declared: pdf.length - 1 })).toBe('length_mismatch');
    expect(await inspect('pdf', pdf, { declared: pdf.length + 1 })).toBe('length_mismatch');
    expect(await inspect('pdf', pdf, { declared: 1 })).toBe('length_mismatch');
  });

  it('reports a body stream that errors midway as length_mismatch', async () => {
    const inspector = createUploadInspector('pdf', 1000);
    const broken = new Readable({
      read() {
        this.push(Buffer.from('%PDF-1.4'));
        this.destroy(new Error('aborted'));
      },
    });
    await expect(
      (async () => {
        for await (const _chunk of inspector.measure(broken)) {
          // drained
        }
      })(),
    ).rejects.toMatchObject({ details: [{ code: 'length_mismatch' }] });
  });
});

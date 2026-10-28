import { crc32 } from 'node:zlib';

export interface ZipEntryType {
  name: string;
  data: Buffer;
}

/** A ZIP archive with every entry stored uncompressed, in the order given: enough to shape what a detector sees first. */
export function zipOf(entries: ZipEntryType[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
}

const mainType = (mime: string) => Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/x" ContentType="${mime}.main+xml"/></Types>`);

export const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A Word file as Word writes it: `[Content_Types].xml` first. */
export const wordContentTypesFirst = (padding = 0): Buffer =>
  zipOf([
    { name: '[Content_Types].xml', data: mainType(WORD_MIME) },
    { name: 'word/document.xml', data: Buffer.alloc(padding, 'x') },
  ]);

/** A Word file as LibreOffice writes it: the content first, `[Content_Types].xml` last. */
export const wordContentTypesLast = (padding = 0): Buffer =>
  zipOf([
    { name: '_rels/.rels', data: Buffer.from('<Relationships/>') },
    { name: 'word/document.xml', data: Buffer.alloc(padding, 'x') },
    { name: '[Content_Types].xml', data: mainType(WORD_MIME) },
  ]);

export const plainZip = (): Buffer => zipOf([{ name: 'notes/readme.txt', data: Buffer.from('not an office file') }]);

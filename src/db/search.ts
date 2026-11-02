/** An `ilike` pattern for text containing `text`; `%`, `_`, and `\` in it are matched literally (P11.6). */
export const containing = (text: string) => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

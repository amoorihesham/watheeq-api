/** The object-store key of a file: derived, never stored, and never containing the user's file name (P5.5.4). */
export function storageKeyOf(tenantId: string, fileId: string): string {
  return `${tenantId}/${fileId}`;
}

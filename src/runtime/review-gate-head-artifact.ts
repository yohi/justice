export interface GitTreeEntry {
  readonly gitMode: "100644" | "100755";
  readonly blobSha: string;
}

export function parseBlobTreeEntry(stdout: Buffer, canonicalPath: string): GitTreeEntry | null {
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    const [meta = "", entryPath = ""] = record.split("\t", 2);
    if (entryPath !== canonicalPath) continue;
    const [gitMode = "", type = "", blobSha = ""] = meta.split(" ");
    if (type !== "blob" || (gitMode !== "100644" && gitMode !== "100755")) return null;
    return { gitMode, blobSha };
  }
  return null;
}

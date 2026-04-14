/**
 * Build virtual FileSystemDirectoryHandle / FileSystemFileHandle objects from
 * APIs available in all browsers (FileList from <input webkitdirectory> and
 * FileSystemEntry from drag-and-drop).  The virtual handles implement enough
 * of the File System Access API that all session discovery and bundling works.
 */

type AnyHandle = VirtualDirHandle | VirtualFileHandle;

class VirtualFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  private readonly _file: File;

  constructor(name: string, file: File) {
    this.name = name;
    this._file = file;
  }

  getFile(): Promise<File> {
    return Promise.resolve(this._file);
  }
}

class VirtualDirHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  readonly _children = new Map<string, AnyHandle>();

  constructor(name: string) {
    this.name = name;
  }

  async *entries(): AsyncGenerator<[string, AnyHandle]> {
    for (const entry of this._children) {
      yield entry;
    }
  }

  getDirectoryHandle(name: string): Promise<VirtualDirHandle> {
    const child = this._children.get(name);
    if (child?.kind === "directory") return Promise.resolve(child);
    return Promise.reject(new DOMException(`${name} not found`, "NotFoundError"));
  }

  getFileHandle(name: string): Promise<VirtualFileHandle> {
    const child = this._children.get(name);
    if (child?.kind === "file") return Promise.resolve(child);
    return Promise.reject(new DOMException(`${name} not found`, "NotFoundError"));
  }
}

/**
 * Build a virtual directory handle from a FileList
 * (returned by <input type="file" webkitdirectory>).
 * The returned handle corresponds to the selected root directory.
 */
export function buildHandleFromFileList(fileList: FileList): FileSystemDirectoryHandle {
  const rootName =
    fileList.length > 0 ? (fileList[0]!.webkitRelativePath.split("/")[0] ?? "") : "";
  const root = new VirtualDirHandle(rootName);

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i]!;
    const parts = file.webkitRelativePath.split("/");
    // parts[0] = root dir name; parts[1..n-1] = intermediate dirs; parts[n] = file name
    let dir = root;
    for (let j = 1; j < parts.length - 1; j++) {
      const part = parts[j]!;
      let child = dir._children.get(part);
      if (!child) {
        child = new VirtualDirHandle(part);
        dir._children.set(part, child);
      }
      if (child.kind !== "directory") break;
      dir = child;
    }
    const fileName = parts[parts.length - 1];
    if (fileName) {
      dir._children.set(fileName, new VirtualFileHandle(fileName, file));
    }
  }

  return root as unknown as FileSystemDirectoryHandle;
}

/**
 * Build a virtual directory handle from a FileSystemEntry
 * (returned by DataTransferItem.webkitGetAsEntry() in drag-and-drop).
 * Reads the full directory tree recursively.
 */
export async function buildHandleFromEntry(
  entry: FileSystemEntry,
): Promise<FileSystemDirectoryHandle> {
  const root = new VirtualDirHandle(entry.name);
  if (entry.isDirectory) {
    await fillFromDirEntry(root, entry as FileSystemDirectoryEntry);
  }
  return root as unknown as FileSystemDirectoryHandle;
}

async function fillFromDirEntry(
  dir: VirtualDirHandle,
  entry: FileSystemDirectoryEntry,
): Promise<void> {
  const reader = entry.createReader();
  const allEntries: FileSystemEntry[] = [];

  // readEntries returns at most 100 entries per call; keep calling until empty
  await new Promise<void>((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) { resolve(); return; }
        allEntries.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });

  await Promise.all(
    allEntries.map(async (child) => {
      if (child.isFile) {
        const file = await new Promise<File>((res, rej) =>
          (child as FileSystemFileEntry).file(res, rej),
        );
        dir._children.set(child.name, new VirtualFileHandle(child.name, file));
      } else if (child.isDirectory) {
        const childDir = new VirtualDirHandle(child.name);
        dir._children.set(child.name, childDir);
        await fillFromDirEntry(childDir, child as FileSystemDirectoryEntry);
      }
    }),
  );
}

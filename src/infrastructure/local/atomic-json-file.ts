import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type AtomicJsonFileOptions = {
  replace?: (temporaryPath: string, activePath: string) => Promise<void>;
};

export async function writeJsonAtomically(
  filePath: string,
  value: unknown,
  options: AtomicJsonFileOptions = {},
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const replace = options.replace ?? rename;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await replace(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

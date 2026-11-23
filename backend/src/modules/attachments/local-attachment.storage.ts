import { createReadStream, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { Inject, Injectable, Optional } from '@nestjs/common';

export const ATTACHMENT_STORAGE_DIR = Symbol('ATTACHMENT_STORAGE_DIR');
export const DEFAULT_ATTACHMENT_STORAGE_DIR = path.resolve(
  __dirname,
  '../../..',
  'storage',
  'attachments',
);

const SAFE_STORED_FILENAME_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|pdf)$/i;

@Injectable()
export class LocalAttachmentStorage {
  private readonly baseDir: string;

  constructor(@Optional() @Inject(ATTACHMENT_STORAGE_DIR) baseDir?: string) {
    this.baseDir = path.resolve(baseDir ?? DEFAULT_ATTACHMENT_STORAGE_DIR);
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public async save(storedFilename: string, data: Buffer): Promise<void> {
    const targetPath = this.resolveSafePath(storedFilename);
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(targetPath, data);
  }

  public async openReadStream(
    storedFilename: string,
  ): Promise<{ size: number; stream: Readable } | null> {
    const targetPath = this.resolveSafePath(storedFilename);
    try {
      const stats = await fs.stat(targetPath);
      if (!stats.isFile()) {
        return null;
      }
      return {
        size: stats.size,
        stream: createReadStream(targetPath),
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  public async delete(storedFilename: string): Promise<void> {
    const targetPath = this.resolveSafePath(storedFilename);
    try {
      await fs.unlink(targetPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private resolveSafePath(storedFilename: string): string {
    if (!SAFE_STORED_FILENAME_REGEX.test(storedFilename)) {
      throw new Error('Invalid stored attachment filename format.');
    }
    const resolved = path.resolve(this.baseDir, storedFilename);
    if (!resolved.startsWith(`${this.baseDir}${path.sep}`)) {
      throw new Error('Path traversal detected in attachment storage.');
    }
    return resolved;
  }
}

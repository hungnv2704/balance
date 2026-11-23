import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { argon2id } from '@noble/hashes/argon2';
import { APP_CONFIG, AppConfig } from '../../config/app-config';

const scryptAsync = promisify(scrypt);
const ARGON2_SALT_BYTES = 16;
const ARGON2_HASH_BYTES = 32;

@Injectable()
export class PasswordHasherService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  public async hash(plainPassword: string): Promise<string> {
    const salt = randomBytes(ARGON2_SALT_BYTES);
    const memory = this.config.argon2MemoryKib;
    const iterations = this.config.argon2Iterations;
    const parallelism = this.config.argon2Parallelism;

    const derived = argon2id(plainPassword, salt, {
      m: memory,
      t: iterations,
      p: parallelism,
      dkLen: ARGON2_HASH_BYTES,
    });

    const saltB64 = Buffer.from(salt).toString('base64').replace(/=+$/, '');
    const hashB64 = Buffer.from(derived).toString('base64').replace(/=+$/, '');

    return `$argon2id$v=19$m=${memory},t=${iterations},p=${parallelism}$${saltB64}$${hashB64}`;
  }

  public async verify(plainPassword: string, storedHash: string): Promise<boolean> {
    if (storedHash.startsWith('$argon2id$')) {
      return this.verifyArgon2id(plainPassword, storedHash);
    }
    if (storedHash.startsWith('$scrypt$')) {
      return this.verifyScrypt(plainPassword, storedHash);
    }
    return false;
  }

  /**
   * Used when user email is not found during login to equalize verification timing
   * and mitigate user-enumeration timing side-channels.
   */
  public async verifyDummy(plainPassword: string): Promise<void> {
    const dummySalt = Buffer.alloc(ARGON2_SALT_BYTES, 1);
    argon2id(plainPassword, dummySalt, {
      m: this.config.argon2MemoryKib,
      t: this.config.argon2Iterations,
      p: this.config.argon2Parallelism,
      dkLen: ARGON2_HASH_BYTES,
    });
  }

  private verifyArgon2id(plainPassword: string, phc: string): boolean {
    const parts = phc.split('$');
    // ['', 'argon2id', 'v=19', 'm=19456,t=2,p=1', '<salt>', '<hash>']
    if (parts.length !== 6 || parts[1] !== 'argon2id') {
      return false;
    }

    const paramTokens = parts[3].split(',');
    const params: Record<string, number> = {};
    for (const token of paramTokens) {
      const [k, v] = token.split('=');
      if (k && v) {
        params[k] = Number(v);
      }
    }

    const m = params.m;
    const t = params.t;
    const p = params.p;
    if (!Number.isInteger(m) || !Number.isInteger(t) || !Number.isInteger(p) || m < 8 || t < 1 || p < 1) {
      return false;
    }

    const salt = Buffer.from(parts[4], 'base64');
    const expectedHash = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expectedHash.length === 0) {
      return false;
    }

    const computed = Buffer.from(
      argon2id(plainPassword, salt, {
        m,
        t,
        p,
        dkLen: expectedHash.length,
      }),
    );

    return computed.length === expectedHash.length && timingSafeEqual(computed, expectedHash);
  }

  private async verifyScrypt(plainPassword: string, encoded: string): Promise<boolean> {
    const parts = encoded.split('$');
    if (parts.length !== 5 || parts[1] !== 'scrypt') {
      return false;
    }
    const salt = Buffer.from(parts[3], 'base64');
    const expectedHash = Buffer.from(parts[4], 'base64');
    const derived = (await scryptAsync(plainPassword, salt, expectedHash.length)) as Buffer;
    return derived.length === expectedHash.length && timingSafeEqual(derived, expectedHash);
  }
}

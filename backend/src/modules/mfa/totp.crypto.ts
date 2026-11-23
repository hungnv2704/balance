import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_STEPS = 1;
export const TOTP_ISSUER = 'SoTaiChinh';
export const RECOVERY_CODE_COUNT = 8;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_CIPHER_VERSION = 'v1';
const HKDF_SALT = Buffer.from('pfm-mfa-totp-salt-v1', 'utf8');
const HKDF_INFO = Buffer.from('aes-256-gcm-totp-secret', 'utf8');

export function base32Encode(data: Buffer): string {
  if (data.length === 0) {
    return '';
  }

  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.trim().replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase();
  if (cleaned.length === 0) {
    throw new Error('Base32 secret cannot be empty.');
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): { raw: Buffer; base32: string } {
  const raw = randomBytes(byteLength);
  return {
    raw,
    base32: base32Encode(raw),
  };
}

export function generateTotpCode(
  secret: Buffer,
  timestampMs: number = Date.now(),
  periodSeconds: number = TOTP_PERIOD_SECONDS,
  digits: number = TOTP_DIGITS,
): string {
  const counter = Math.floor(timestampMs / 1000 / periodSeconds);
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error('Invalid timestamp for TOTP calculation.');
  }

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const modulo = 10 ** digits;
  const otp = binary % modulo;
  return otp.toString(10).padStart(digits, '0');
}

export function verifyTotpCode(
  secret: Buffer,
  candidateCode: string,
  timestampMs: number = Date.now(),
  windowSteps: number = TOTP_WINDOW_STEPS,
): boolean {
  const normalized = candidateCode.trim();
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const candidateBuf = Buffer.from(normalized, 'utf8');
  let matched = false;

  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const stepMs = timestampMs + offset * TOTP_PERIOD_SECONDS * 1000;
    if (stepMs < 0) {
      continue;
    }
    const expected = generateTotpCode(secret, stepMs);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (expectedBuf.length === candidateBuf.length && timingSafeEqual(expectedBuf, candidateBuf)) {
      matched = true;
    }
  }

  return matched;
}

export function buildOtpauthUri(
  accountEmail: string,
  secretBase32: string,
  issuer: string = TOTP_ISSUER,
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const label = `${encodedIssuer}:${encodeURIComponent(accountEmail)}`;
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

function deriveAes256Key(masterSecret: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(masterSecret, 'utf8'), HKDF_SALT, HKDF_INFO, 32),
  );
}

export function encryptTotpSecret(
  secretRaw: Buffer,
  userId: string,
  masterSecret: string,
): string {
  const key = deriveAes256Key(masterSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(secretRaw), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${TOTP_CIPHER_VERSION}:${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptTotpSecret(
  encryptedPayload: string,
  userId: string,
  masterSecret: string,
): Buffer {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 4 || parts[0] !== TOTP_CIPHER_VERSION) {
    throw new Error('Malformed encrypted TOTP secret payload.');
  }

  const iv = Buffer.from(parts[1], 'base64');
  const authTag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');

  if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
    throw new Error('Invalid encrypted TOTP secret components.');
  }

  const key = deriveAes256Key(masterSecret);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(userId, 'utf8'));
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function normalizeRecoveryCode(input: string): string {
  return input.trim().replace(/[\s-]+/g, '').toUpperCase();
}

export function hashRecoveryCode(input: string): string {
  const normalized = normalizeRecoveryCode(input);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export function generateRecoveryCodes(
  count: number = RECOVERY_CODE_COUNT,
): Array<{ displayCode: string; codeHash: string }> {
  const codes: Array<{ displayCode: string; codeHash: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    const displayCode = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    codes.push({
      displayCode,
      codeHash: hashRecoveryCode(displayCode),
    });
  }
  return codes;
}

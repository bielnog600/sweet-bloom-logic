import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function encrypt(data: string, key: string): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(16);
  const keyBuffer = Buffer.from(key, 'hex');
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);

  let encrypted = cipher.update(data, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const tag = cipher.getAuthTag();

  return { encrypted, iv, tag };
}

export function decrypt(encrypted: Buffer, iv: Buffer, tag: Buffer, key: string): string {
  const keyBuffer = Buffer.from(key, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

import { argon2id, hash, verify } from "argon2";

export const PASSWORD_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;
export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_OPTIONS);
}
export function verifyPassword(
  encoded: string,
  password: string,
): Promise<boolean> {
  return verify(encoded, password);
}

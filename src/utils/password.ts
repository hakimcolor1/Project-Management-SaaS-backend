import bcrypt from "bcrypt";
import { z } from "zod";

/** bcrypt cost factor: ~250 ms per hash on typical hardware. */
export const BCRYPT_SALT_ROUNDS = 12;

/** bcrypt only uses the first 72 bytes of its input. */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/**
 * Password policy shared by registration and the admin seed:
 * 8+ characters, at most 72 bytes, with upper-case, lower-case and a digit.
 */
export const strongPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((value) => Buffer.byteLength(value, "utf8") <= BCRYPT_MAX_PASSWORD_BYTES, {
    message: `Password must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes`,
  })
  .regex(/[a-z]/, "Password must contain a lower-case letter")
  .regex(/[A-Z]/, "Password must contain an upper-case letter")
  .regex(/\d/, "Password must contain a number");

export const hashPassword = (plainPassword: string): Promise<string> =>
  bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

export const comparePassword = (plainPassword: string, passwordHash: string): Promise<boolean> =>
  bcrypt.compare(plainPassword, passwordHash);

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getConfigDir } from "./config";

const KEYCHAIN_FILE = "keychain.enc";
const SEPARATOR = "-----BEGIN COVIBE KEY-----\n";
const END_SEPARATOR = "\n-----END COVIBE KEY-----";

interface KeyChain {
  encryptedPrivateKey: string; // AES-GCM encrypted with password-derived key
  salt: string;                // PBKDF2 salt for key derivation
  iv: string;                  // AES-GCM IV
  publicKey: string;           // Stored in plaintext (public key is not secret)
}

export function hasKey(): boolean {
  return existsSync(join(getConfigDir(), KEYCHAIN_FILE));
}

export function storeEncryptedKey(
  encryptedPrivateKey: Uint8Array,
  salt: Uint8Array,
  iv: Uint8Array,
  publicKey: Uint8Array
): void {
  const chain: KeyChain = {
    encryptedPrivateKey: btoa(String.fromCharCode(...encryptedPrivateKey)),
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    publicKey: btoa(String.fromCharCode(...publicKey)),
  };
  const payload = SEPARATOR + JSON.stringify(chain) + END_SEPARATOR;
  writeFileSync(join(getConfigDir(), KEYCHAIN_FILE), payload, "utf-8");
}

export function loadKeyChain(): KeyChain | null {
  try {
    const raw = readFileSync(join(getConfigDir(), KEYCHAIN_FILE), "utf-8");
    const json = raw.replace(SEPARATOR, "").replace(END_SEPARATOR, "");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function clearKey(): void {
  try {
    const { unlinkSync } = require("fs");
    unlinkSync(join(getConfigDir(), KEYCHAIN_FILE));
  } catch {}
}

export function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  // PBKDF2-SHA256: 600k iterations (OWASP 2025 recommendation)
  const enc = new TextEncoder();
  const keyMaterial = enc.encode(password);
  return crypto.subtle.importKey("raw", keyMaterial, "PBKDF2", false, ["deriveBits"]).then((key) =>
    crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" },
      key,
      256
    )
  ).then((bits) => new Uint8Array(bits));
}

export async function decryptPrivateKey(password: string): Promise<Uint8Array | null> {
  const chain = loadKeyChain();
  if (!chain) return null;

  const salt = Uint8Array.from(atob(chain.salt), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(chain.iv), (c) => c.charCodeAt(0));
  const encrypted = Uint8Array.from(atob(chain.encryptedPrivateKey), (c) => c.charCodeAt(0));

  const key = await deriveKey(password, salt);
  const aesKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]);

  try {
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, encrypted);
    return new Uint8Array(decrypted);
  } catch {
    return null; // Wrong password
  }
}

export async function generateAndStoreKey(password: string): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  // Generate X25519 keypair using SubtleCrypto
  const keypair = await crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveBits", "deriveKey"]
  );

  const pubRaw = await crypto.subtle.exportKey("raw", keypair.publicKey);
  const privRaw = await crypto.subtle.exportKey("raw", keypair.privateKey);

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const aesKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, privRaw);

  storeEncryptedKey(new Uint8Array(encrypted), salt, iv, new Uint8Array(pubRaw));
  return { publicKey: new Uint8Array(pubRaw), privateKey: new Uint8Array(privRaw) };
}

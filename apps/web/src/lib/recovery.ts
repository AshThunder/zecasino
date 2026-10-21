"use client";
/**
 * Session recovery, browser-only. The session key (32 random bytes) is the bearer credential for a balance; the
 * server stores only SHA-256(key). Recovery = giving the player that key in a form they can keep:
 *  - a recovery code: Crockford base32 of the key + a 16-bit SHA-256 checksum, in groups of 4 (typos are caught);
 *  - a backup file, optionally sealed with a passphrase (PBKDF2-SHA256 → AES-256-GCM, all WebCrypto).
 * Nothing new is sent to or stored on the server: no email, no account, no withdrawal address.
 */
import { DEMO, KEEP_KEY, SESSION_KEY } from "./server";

const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const hexToBytes = (h: string) => new Uint8Array(h.match(/../g)!.map(x => parseInt(x, 16)));
const bytesToHex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
async function sum(b: Uint8Array) { return new Uint8Array(await crypto.subtle.digest("SHA-256", b as BufferSource)).slice(0, 2); }
function b32(b: Uint8Array) { let bits = 0, v = 0, out = ""; for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += A[(v << (5 - bits)) & 31]; return out; }
function unb32(s: string) { let bits = 0, v = 0; const out: number[] = []; for (const c of s) { const i = A.indexOf(c); if (i < 0) return null; v = (v << 5) | i; bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }

export async function toCode(tokenHex: string) {
  const k = hexToBytes(tokenHex); const all = new Uint8Array([...k, ...(await sum(k))]);
  return (DEMO ? "PLAY-" : "ZEC-") + b32(all).match(/.{1,4}/g)!.join("-");
}
/** Accepts a code (any case, spaces/dashes, I/L→1, O→0) or a raw 64-hex key. Returns the key or null. */
export async function fromCode(input: string): Promise<string | null> {
  const t = input.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) return t.toLowerCase();
  const s = t.toUpperCase().replace(/^(ZEC|PLAY)[-\s]*/, "").replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  const b = unb32(s); if (!b || b.length < 34) return null;
  const k = b.slice(0, 32), c = b.slice(32, 34), want = await sum(k);
  return c[0] === want[0] && c[1] === want[1] ? bytesToHex(k) : null;
}

type Backup = { app: "zecasino"; v: 1; mode: "real" | "demo"; created: string; code?: string; sealed?: { salt: string; iv: string; ct: string; iter: number } };
async function aes(pass: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function backupBlob(tokenHex: string, passphrase?: string) {
  const code = await toCode(tokenHex);
  const b: Backup = { app: "zecasino", v: 1, mode: DEMO ? "demo" : "real", created: new Date().toISOString() };
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 310_000;
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(passphrase, salt, iter), new TextEncoder().encode(code)));
    b.sealed = { salt: bytesToHex(salt), iv: bytesToHex(iv), ct: bytesToHex(ct), iter };
  } else b.code = code;
  return new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
}
export function download(blob: Blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `zecasino-${DEMO ? "play-" : ""}session-backup.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** Parse a backup file. Returns { needsPass } when sealed and no passphrase was given. */
export async function readBackup(text: string, passphrase?: string): Promise<{ token?: string; needsPass?: boolean; error?: string; mode?: string }> {
  let b: Backup; try { b = JSON.parse(text); } catch { return { error: "That file isn't a Zecasino backup." }; }
  if (b.app !== "zecasino") return { error: "That file isn't a Zecasino backup." };
  let code = b.code;
  if (b.sealed) {
    if (!passphrase) return { needsPass: true, mode: b.mode };
    try { const s = b.sealed; code = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(s.iv) }, await aes(passphrase, hexToBytes(s.salt), s.iter), hexToBytes(s.ct))); }
    catch { return { error: "Wrong passphrase for this backup.", needsPass: true }; }
  }
  const token = code ? await fromCode(code) : null;
  return token ? { token, mode: b.mode } : { error: "The backup is damaged (checksum failed)." };
}
export const currentToken = () => sessionStorage.getItem(SESSION_KEY) ?? "";
const SAVED = () => `zc.${DEMO ? "demo." : ""}recovery.saved`;
export const isSaved = (tok: string) => { try { return !!tok && localStorage.getItem(SAVED()) === tok.slice(-6); } catch { return false; } };
export const markSaved = (tok: string) => { try { localStorage.setItem(SAVED(), tok.slice(-6)); } catch { /* */ } };
/** Switch this browser to the restored session and reload. */
export function adopt(token: string, keep: boolean) {
  sessionStorage.setItem(SESSION_KEY, token); if (keep) localStorage.setItem(KEEP_KEY, token); else localStorage.removeItem(KEEP_KEY);
  markSaved(token); sessionStorage.setItem("zc.restored", "1"); location.reload();
}

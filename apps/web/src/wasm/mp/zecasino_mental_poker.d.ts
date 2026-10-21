/* tslint:disable */
/* eslint-disable */

export function mp_joint_key(pks: string): string;

export function mp_keygen(): string;

export function mp_open_deck(): string;

export function mp_share(sk: string, card: string): string;

export function mp_shuffle(deck: string, joint: string): string;

export function mp_unmask(card: string, shares: string): number;

export function mp_verify_share(pk: string, card: string, share: string): boolean;

export function mp_verify_shuffle(input: string, output: string, joint: string, proof: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly mp_joint_key: (a: number, b: number) => [number, number, number, number];
    readonly mp_keygen: () => [number, number];
    readonly mp_open_deck: () => [number, number];
    readonly mp_share: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly mp_shuffle: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly mp_unmask: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly mp_verify_share: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly mp_verify_shuffle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

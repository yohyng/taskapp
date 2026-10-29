import init from 'loro-crdt/web';
import wasmUrl from 'loro-crdt/web/loro_wasm_bg.wasm?url';

// WASMを大きいBase64のJavaScriptへ埋め込まず、通常の静的アセットとして読み込む。
await init({ module_or_path: wasmUrl });
export * from 'loro-crdt/web';

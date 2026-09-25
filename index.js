// Top-level entrypoint for OpenCode V2 local plugin discovery.
//
// OpenCode resolves a plugin package directory to a top-level index.ts/index.js
// (a `main` entry in a subdirectory such as dist/ is silently skipped), while
// npm consumers resolve through `exports`/`main` as usual. This shim keeps both
// working: local discovery loads this file, which re-exports the build output.
export * from "./dist/index.js";
export { default } from "./dist/index.js";

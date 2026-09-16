// Limits shared by the browser side of ingestion and the server side of
// acceptance.
//
// This constant used to live in ingest.ts, which depends on File,
// FileReader and canvas. That meant the server could not import it
// without dragging a browser-only module in, which is part of why the
// server had no size check at all. It is one number and it belongs
// somewhere both sides can reach.

// Mirrors Bridge's MAX_API_BYTES (diCheckSize): a safe upper bound for
// base64 content going to the model, checked before any expensive
// decode or normalize work, not after.
export const MAX_INGEST_BYTES = 4 * 1024 * 1024;

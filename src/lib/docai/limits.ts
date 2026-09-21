// Limits shared by the browser side of ingestion and the server side of
// acceptance.
//
// This constant used to live in ingest.ts, which depends on File,
// FileReader and canvas. That meant the server could not import it
// without dragging a browser-only module in, which is part of why the
// server had no size check at all. It is one number and it belongs
// somewhere both sides can reach.

// Descended from Bridge's MAX_API_BYTES (diCheckSize): an upper bound on
// what goes to the model. Ten megabytes because a scanner's PDF at
// 300dpi runs one to two megabytes a page and a four page transcript did
// not fit the original 4MB; still well under the model's own 32MB limit.
// The documents bucket carries the same number (migration 0029).
export const MAX_INGEST_BYTES = 10 * 1024 * 1024;

// The longest edge an uploaded photo is scaled down to before it is
// sent. The model itself downsamples anything over about 1600px, so
// pixels past this cost tokens and upload time and read no better. A
// 12 megapixel phone photo comes down to a few hundred kilobytes.
export const MAX_IMAGE_EDGE = 2000;

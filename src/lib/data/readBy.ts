// Which model read a document, and whether what it read may ever touch
// an athlete. Plain functions, outside the "use server" action file, so
// the review screen, the actions and a law all ask the same question.
//
// Why this exists (audit wired F1): with no AI key on the server every
// document is read by the stand-in (src/lib/docai/stubCaller.ts), which
// invents a transcript: a GPA marked verified, a date of birth, a school
// and a course list. Applying one wrote that invented record onto a real
// minor's file. documents.read_by (migration 0040) records the reader at
// processing time, and a database trigger keeps a 'stub' mark forever.

export const STUB_READER = "stub";

// What goes in documents.read_by when a document is created: the stand-in
// when no key is set, otherwise the model that does the reading.
export function readerFor(stubbed: boolean, model: string): string {
  return stubbed ? STUB_READER : model;
}

export interface ApplyGate {
  // documents.read_by: 'stub', a model id, or null for a document read
  // before 0040 recorded it.
  readBy: string | null;
  // True while no AI key is set on the server.
  stubbed: boolean;
  // True when the org's model ledger (docai_usage) holds a call for this
  // document: proof a real model read it. Only consulted when readBy is
  // null.
  ledgerShowsRealRead: boolean;
}

// The reason a document can not be applied, or null when it can. Every
// path that writes a reading onto an athlete goes through this.
export function applyRefusal(gate: ApplyGate): string | null {
  if (gate.readBy === STUB_READER) {
    return "This was read while no AI key was set, so what it shows was made up by the stand-in, not read off the page. It can never be applied. Discard it and upload the file again once the AI key is set.";
  }
  if (gate.stubbed) {
    return "No AI key is set, so nothing read here can be applied to an athlete yet. Once the key is set, upload the file again.";
  }
  // Read before 0040. Every document read before then was read by the
  // stand-in unless the model ledger shows a real call for it, and a
  // blank reader is not proof of a real one.
  if (gate.readBy === null && !gate.ledgerShowsRealRead) {
    return "This was read before the app recorded which model read each document, and nothing shows a real model read it. Discard it and upload the file again.";
  }
  return null;
}

// True for a document the stand-in read: its contents are invented, so
// editing them by hand does not make them real either.
export function isStubReading(readBy: string | null): boolean {
  return readBy === STUB_READER;
}

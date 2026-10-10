// A board meeting's fields (migration 0050), checked the same way on the
// form and on the server. Limits match the table's check constraints.

export const MEETING_TITLE_MAX = 120;
export const MEETING_LOCATION_MAX = 200;
export const MEETING_NOTES_MAX = 4000;

export interface MeetingRow {
  title: string;
  meets_on: string;
  board_id: string | null;
  location: string | null;
  notes: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseMeetingForm(formData: FormData): { row: MeetingRow } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = String(formData.get("title") ?? "").trim();
  const meetsOn = String(formData.get("meetsOn") ?? "").trim();
  const boardId = String(formData.get("boardId") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!title) errors.title = "A meeting needs a title, like October Board Meeting.";
  else if (title.length > MEETING_TITLE_MAX) errors.title = `Keep it under ${MEETING_TITLE_MAX} characters.`;
  if (!meetsOn) errors.meetsOn = "When is it?";
  else if (!realDate(meetsOn)) errors.meetsOn = "That is not a date.";
  if (boardId && !/^[0-9a-f-]{36}$/.test(boardId)) errors.boardId = "Pick a board from the list.";
  if (location.length > MEETING_LOCATION_MAX) errors.location = `Keep it under ${MEETING_LOCATION_MAX} characters.`;
  if (notes.length > MEETING_NOTES_MAX) errors.notes = `Keep it under ${MEETING_NOTES_MAX} characters.`;
  if (Object.keys(errors).length) return { errors };

  return { row: { title, meets_on: meetsOn, board_id: boardId || null, location: location || null, notes: notes || null } };
}

// Upcoming is today or later in the org's day; the rest are past.
export function splitMeetings<T extends { meets_on: string }>(rows: T[], today: string): { upcoming: T[]; past: T[] } {
  const upcoming = rows.filter((m) => m.meets_on >= today).sort((a, b) => a.meets_on.localeCompare(b.meets_on));
  const past = rows.filter((m) => m.meets_on < today).sort((a, b) => b.meets_on.localeCompare(a.meets_on));
  return { upcoming, past };
}

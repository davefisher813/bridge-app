// Board seats to donor records (Oct 13: every seat on the board was
// unlinked, so the board showed $0 given while the gifts were on the
// donors). A seat is matched only when its name is exactly one donor's
// name once case, accents and punctuation are set aside. Two donors of
// that name, or none, is left for a person to pick on the seat. Pure.

export interface SeatRef {
  id: string;
  name: string;
  donorId: string | null;
}

export interface DonorRef {
  id: string;
  name: string;
}

export interface SeatDonorMatch {
  seatId: string;
  seatName: string;
  donorId: string;
  donorName: string;
}

const key = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function matchSeatsToDonors(seats: SeatRef[], donors: DonorRef[]): SeatDonorMatch[] {
  const byName = new Map<string, DonorRef[]>();
  for (const d of donors) {
    const k = key(d.name);
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), d]);
  }
  const out: SeatDonorMatch[] = [];
  for (const s of seats) {
    if (s.donorId) continue;
    const hits = byName.get(key(s.name)) ?? [];
    if (hits.length === 1) out.push({ seatId: s.id, seatName: s.name, donorId: hits[0]!.id, donorName: hits[0]!.name });
  }
  return out;
}

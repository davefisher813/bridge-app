-- An award letter, applied. Doc AI reads a financial aid award letter
-- for one athlete at one school; what it says is the best evidence the
-- financial dimension can have, better than any average on the school
-- record. It lives on the recruiting target, the one row that is about
-- this athlete and this school, as jsonb validated in code
-- (src/lib/data/fitAdapters.ts): academic year, cost of attendance, the
-- awards, the net cost, and the document it came from.
alter table recruiting_targets add column aid jsonb;

comment on column recruiting_targets.aid is
  'What an award letter said for this athlete at this school: { academicYear, totalCostOfAttendance, netCost, efc, sai, awards, documentId }. Written by Doc AI; null until an award letter is applied. Shape validated in code.';

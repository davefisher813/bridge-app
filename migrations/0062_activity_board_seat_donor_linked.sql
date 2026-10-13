-- 0062: linking board seats to donor records is logged (Oct 13: every
-- seat was unlinked, so the board showed $0 given). One activity action.

alter type activity_action add value if not exists 'board_seat_donor_linked';

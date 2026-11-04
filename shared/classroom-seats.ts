/** Five seats per row, filled from row 1 through row 5. Never skip column 5. */
export const CLASSROOM_SEATS = Array.from({ length: 25 }, (_, index) =>
  `Seat_R${Math.floor(index / 5) + 1}_${String(index % 5 + 1).padStart(2, '0')}`);

export function firstAvailableClassroomSeat(occupied: Iterable<string | null>): string | undefined {
  const used = new Set(occupied);
  return CLASSROOM_SEATS.find(seat => !used.has(seat));
}

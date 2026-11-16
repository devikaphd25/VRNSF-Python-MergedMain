/** Canonical seat identifiers and small seat lookup helpers shared by classroom systems. */
import { CLASSROOM_SEATS } from "../../shared/classroom-seats";
export type SeatType = 'Seat_R0_00' | `Seat_R${1 | 2 | 3 | 4 | 5}_${'01' | '02' | '03' | '04' | '05'}`;
const Seats = ['Seat_R0_00', ...CLASSROOM_SEATS] as SeatType[];

export const SeatType = Object.fromEntries(
    Seats.map(s => [s,s]),
) as Record<SeatType, SeatType>;

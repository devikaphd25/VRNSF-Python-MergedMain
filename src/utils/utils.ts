const Seats = [
    'Seat_R0_00',
    'Seat_R1_01', 'Seat_R1_02', 'Seat_R1_03', 'Seat_R1_04', 'Seat_R1_05',
    'Seat_R2_01', 'Seat_R2_02', 'Seat_R2_03', 'Seat_R2_04', 'Seat_R2_05',
    'Seat_R3_01', 'Seat_R3_02', 'Seat_R3_03', 'Seat_R3_04', 'Seat_R3_05',
] as const;

export type SeatType = (typeof Seats)[number];
export const SeatType = Object.fromEntries(
    Seats.map(s => [s,s]),
) as Record<SeatType, SeatType>;
import { createSystem, Group, ne, Object3DEventMap, Quaternion, Vector3 } from "@iwsdk/core";
import { SeatComponent } from "../components/seat.component";
import { SeatType } from "../utils/utils";
import { socket } from "../network/socket";
import { updateSeatMarkers } from "../components/instructor/seat-markers";
type StudentInfo = {
    id: string;
    name: string;
    seat: string;
    mode: string;
    isDemo: boolean;
};

export class SeatSystem extends createSystem({
    seat: {
        required: [SeatComponent],
        where: [ne(SeatComponent, "name", SeatType.Seat_R0_00)]
    }
}) {
    private position: Vector3 | undefined;
    private quaternion: Quaternion | undefined;

    init() {
        socket.on("seatAccepted", (acceptedSeatName: string) => {
            console.log("Seat accepted:", acceptedSeatName);
        });

        socket.on("seatRejected", (data: { seat: string; message: string }) => {
            console.log("Seat rejected:", data.message);
            alert(data.message);
            this.player.position.set(0, 0, 0);
        });

        socket.on("studentList", (students: StudentInfo[]) => {
    updateSeatMarkers(students, this.scene, this.scene);
});

        this.queries.seat.subscribe("qualify", (e) => {
            const scene = e.getValue(SeatComponent, "scene") as Group<Object3DEventMap>;
            const seatName = e.getValue(SeatComponent, "name");

            if (!(seatName && scene)) return;

            const seat = scene.getObjectByName(seatName);
            if (!seat) return;

            this.position = new Vector3();
            this.quaternion = new Quaternion();

            seat.getWorldPosition(this.position);
            seat.getWorldQuaternion(this.quaternion);

            const flipY = new Quaternion().setFromAxisAngle(
                new Vector3(0, 1, 0),
                Math.PI
            );

            this.quaternion.multiply(flipY);

            socket.emit("requestJoinSeat", seatName);

            this.player.position.copy(this.position);
            this.player.quaternion.copy(this.quaternion);
        });
    }
}
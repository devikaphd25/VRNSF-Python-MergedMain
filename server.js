import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const demoStudents = [
  {
    id: "demo-1",
    name: "Demo 1",
    seat: "Seat_R1_01",
    mode: "Classroom Mode",
    isDemo: true,
  },
  {
    id: "demo-2",
    name: "Demo 2",
    seat: "Seat_R1_02",
    mode: "Presentation Mode",
    isDemo: true,
  },
  {
    id: "demo-3",
    name: "Demo 3",
    seat: "Seat_R1_03",
    mode: "Classroom Mode",
    isDemo: true,
  },
];

const students = {};

function getStudentList() {
  return [...demoStudents, ...Object.values(students)];
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  students[socket.id] = {
    id: socket.id,
    name: socket.id.substring(0, 6),
    seat: "Not selected",
    mode: "Classroom Mode",
    isDemo: false,
    position: { x: 0, y: 1, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    handRaised: false,
  };
  socket.emit("currentPlayers", students);
  io.emit("studentList", getStudentList());
  socket.on("requestStudentList", () => {
  socket.emit("studentList", getStudentList());
});

  socket.on("requestJoinSeat", (seat) => {
    const takenSeats = getStudentList()
      .map((s) => s.seat)
      .filter((seat) => seat && seat !== "Not selected");

    if (takenSeats.includes(seat)) {
      socket.emit("seatRejected", {
        seat,
        message: "This seat is already taken.",
      });
      return;
    }

    students[socket.id].seat = seat;

    socket.emit("seatAccepted", seat);
    io.emit("studentList", getStudentList());
  });

  socket.on("modeChanged", (mode) => {
    if (!students[socket.id]) return;

    students[socket.id].mode = mode;
    io.emit("studentList", getStudentList());
  });
  socket.on("raiseHand", (isRaised) => {
  if (!students[socket.id]) return;

  students[socket.id].handRaised = isRaised;
  io.emit("studentList", getStudentList());
});
  socket.on("playerUpdate", (data) => {
    if (!students[socket.id]) return;

    students[socket.id].position = data.position;
    students[socket.id].rotation = data.rotation;

    socket.broadcast.emit("playerMoved", {
      id: socket.id,
      position: data.position,
      rotation: data.rotation,
      name: students[socket.id].name,
      seat: students[socket.id].seat,
    });
  });

  socket.on("disconnect", () => {
    delete students[socket.id];
    io.emit("studentList", getStudentList());
  });
});

httpServer.listen(3001, () => {
  console.log("Socket.IO server running on http://localhost:3001");
});
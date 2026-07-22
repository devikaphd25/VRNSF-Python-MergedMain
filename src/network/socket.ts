// src/network/socket.ts

import { io } from "socket.io-client";

/*
 * When opened on the Mac:
 * hostname may be localhost.
 *
 * When opened on the headset:
 * hostname will be the Mac's local IP address,
 * such as 192.168.1.25.
 */
const serverHost = window.location.hostname;

const socketServerUrl =
  `http://${serverHost}:3001`;

console.log(
  "[Socket] Connecting to:",
  socketServerUrl
);

export const socket = io(
  socketServerUrl,
  {
    transports: [
      "websocket",
      "polling"
    ],

    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  }
);

socket.on("connect", () => {
  console.log(
    "[Socket] Connected:",
    socket.id
  );
});

socket.on("connect_error", (error) => {
  console.error(
    "[Socket] Connection error:",
    error.message
  );
});

socket.on("disconnect", (reason) => {
  console.warn(
    "[Socket] Disconnected:",
    reason
  );
});
import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const clients = new Set<string>();

io.on("connection", (socket) => {
  const type = socket.handshake.auth?.type || "client";
  console.log(`[ops-events] ${type} connected: ${socket.id}`);
  clients.add(socket.id);
  
  if (type === "ops_dashboard") {
    socket.emit("events:recent", []);
  }
  io.emit("ops:online", { count: clients.size });
  
  socket.on("event:emit", (event) => {
    console.log(`[ops-events] Broadcasting: ${event.type}`);
    io.emit("event", event);
    io.emit(`event:${event.type}`, event);
  });
  
  socket.on("disconnect", () => {
    clients.delete(socket.id);
    io.emit("ops:online", { count: clients.size });
    console.log(`[ops-events] Disconnected: ${socket.id}. Online: ${clients.size}`);
  });
});

httpServer.listen(3004, () => {
  console.log(`[ops-events] Listening on ${3004}`);
});

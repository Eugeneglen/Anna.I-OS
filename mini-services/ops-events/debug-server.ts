import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer((req, res) => {
  console.log(`[HTTP] ${req.method} ${req.url} ${req.headers.host || ''}`);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

const io = new Server(httpServer, {
  path: "/",
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log(`[WS] Connected: ${socket.id}`);
  socket.on("disconnect", () => console.log(`[WS] Disconnected: ${socket.id}`));
});

httpServer.listen(3004, () => console.log("[debug] Listening on 3004"));

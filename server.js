const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");

dotenv.config();

const app = require("./app");

const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Make io accessible to routes via app
app.set("io", io);

// Socket.io connection handler
io.on("connection", (socket) => {
  console.log(`✅ Socket connected: ${socket.id}`);

  // Join a group room for real-time updates
  socket.on("join:group", (groupId) => {
    socket.join(`group:${groupId}`);
    console.log(`Socket ${socket.id} joined group:${groupId}`);
  });

  // Leave a group room
  socket.on("leave:group", (groupId) => {
    socket.leave(`group:${groupId}`);
    console.log(`Socket ${socket.id} left group:${groupId}`);
  });

  socket.on("disconnect", () => {
    console.log(`❌ Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

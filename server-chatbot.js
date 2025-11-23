const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
// wss://livebeautyofficial.com http://localhost:4000/

const io = new Server(server, {
   cors: {
    origin: [
        "https://livebeautyofficial.com",
        "https://www.livebeautyofficial.com"
    ],
    methods: ["GET", "POST"],
    credentials: true
},

    path: "/chatbot/socket.io"
});


// STOCKAGE
let admins = {};          // { socketId: true }
let clients = {};         // { userId: socketId }
let conversations = {};   // historique

io.on("connection", (socket) => {

    console.log("📌 Nouveau socket connecté :", socket.id);

    // IDENTIFICATION
    socket.on("identify", (data) => {
        console.log("🆔 IDENTIFICATION :", data);

        // ADMIN
        if (data.type === "admin") {
            admins[socket.id] = true;
            console.log("👑 ADMIN connecté :", socket.id);
            return;
        }

        // CLIENT
        if (data.type === "client") {

            const uid = String(data.userId).trim();
            clients[uid] = socket.id;

            console.log(`🙋 CLIENT identifié : ${uid} → socket ${socket.id}`);

            if (!conversations[uid])
                conversations[uid] = { messages: [] };
        }
    });

    // MESSAGE CLIENT → ADMIN
    socket.on("client-message", (data) => {

        const userId = String(data.userId).trim();

        console.log("📨 Message CLIENT reçu :", data);

        if (!clients[userId]) {
            console.log("❌ Client non identifié avant message !");
            return;
        }

        // stockage
        if (!conversations[userId])
            conversations[userId] = { messages: [] };

        conversations[userId].messages.push({
            sender: "client",
            pseudo: data.pseudo,
            message: data.message,
            time: Date.now()
        });

        // envoyer au premier admin connecté
        const adminSocket = Object.keys(admins)[0];
        if (adminSocket) {
            io.to(adminSocket).emit("admin-new-message", {
                userId,
                pseudo: data.pseudo,
                message: data.message
            });
            return;
        }

        // sinon bot auto
        io.to(clients[userId]).emit("bot-reply", {
            message: "Nous sommes absents pour le moment 😘"
        });
    });

    // MESSAGE ADMIN → CLIENT
    socket.on("admin-reply", (data) => {

        const userId = String(data.userId).trim();
        const msg = data.message;
        const clientSocket = clients[userId];

        console.log(`👑 ADMIN → CLIENT ${userId} :`, msg);

        if (!clientSocket) {
            console.log("⚠ Client introuvable !");
            return;
        }

        conversations[userId].messages.push({
            sender: "admin",
            message: msg,
            time: Date.now()
        });

        io.to(clientSocket).emit("chatbot-reply", {
            sender: "Support",
            message: msg
        });
    });

    // DECONNEXION
    socket.on("disconnect", () => {
        console.log("❌ Déconnexion :", socket.id);

        // enlever admin
        if (admins[socket.id])
            delete admins[socket.id];

        // enlever client
        for (let uid in clients)
            if (clients[uid] === socket.id)
                delete clients[uid];
    });
});

server.listen(4000, () => {
    console.log("🚀 Serveur opérationnel : http://localhost:4000/");
});

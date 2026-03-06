const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');

dotenv.config();

// ── Optional MongoDB connection ──────────────────────────────
let usingMongo = false;
let User = null;
let Meeting = null;
let Poll = null;
let Notification = null;
let RSVP = null;
try {
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mcms_db')
        .then(() => {
            console.log('✅ MongoDB Connected');
            usingMongo = true;
        })
        .catch(err => console.log('⚠️  MongoDB not available — using in-memory store:', err.message));
    User = require('./models/User');
    Meeting = require('./models/Meeting');
    Poll = require('./models/Poll');
    Notification = require('./models/Notification');
    RSVP = require('./models/RSVP');
} catch (e) {
    console.log('⚠️  Mongoose not found — using in-memory store');
}

// ── In-memory fallback store ─────────────────────────────────
const inMemoryUsers = [];

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5001;
const JWT_SECRET = process.env.JWT_SECRET || 'mcms_super_secret_key';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors());
app.use(express.json());

// ── Socket.io Setup ──────────────────────────────────────────
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

const connectedUsers = new Map();

io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.id;
        next();
    } catch {
        next(new Error('Invalid token'));
    }
});

// ── WebRTC Rooms & Transcription State ──────────────────────
// meetingId -> Map<socketId, { userId, name, profileImage }>
const meetingRooms = new Map();
// meetingId -> { active, speakers: Map<socketId, { ws, buffer, name, image }> }
const transcriptionSessions = new Map();

let Transcript = null;
try { Transcript = require('./models/Transcript'); } catch {}

const WebSocket = require('ws');

function createSarvamWS(meetingId, socketId, speakerName, speakerImage, broadcastSegment) {
    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
        console.log('⚠️  SARVAM_API_KEY not set — transcription disabled');
        return null;
    }

    const url = 'wss://api.sarvam.ai/speech-to-text-translate/ws?model=saaras:v3&mode=transcribe&sample_rate=16000&input_audio_codec=pcm_s16le';
    let ws;
    try {
        ws = new WebSocket(url, { headers: { 'Api-Subscription-Key': apiKey } });
    } catch (err) {
        console.error('Sarvam WS creation failed:', err.message);
        return null;
    }

    ws.on('open', () => {
        console.log(`🎙️  Sarvam WS open for [${speakerName}] in meeting ${meetingId}`);
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === 'data' && msg.data?.transcript) {
                const text = msg.data.transcript.trim();
                if (!text) return;

                const now = new Date();
                const timestamp = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

                const segment = {
                    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    meetingId,
                    speaker: speakerName,
                    speakerImage,
                    text,
                    timestamp,
                    languageCode: msg.data.language_code || null,
                    sentiment: null,
                };

                broadcastSegment(segment);

                if (usingMongo && Transcript) {
                    Transcript.create({
                        meetingId,
                        speaker: speakerName,
                        speakerImage,
                        text,
                        timestamp,
                        languageCode: msg.data.language_code || null,
                    }).catch(() => {});
                }
            } else if (msg.type === 'error') {
                console.error(`Sarvam error [${speakerName}]:`, msg.data?.error || msg);
            }
        } catch {}
    });

    ws.on('error', (err) => console.error(`Sarvam WS error [${speakerName}]:`, err.message));
    ws.on('close', (code, reason) => console.log(`Sarvam WS closed for [${speakerName}] code=${code} reason=${reason}`));

    return ws;
}

io.on('connection', (socket) => {
    connectedUsers.set(socket.userId, socket.id);
    socket.join(`user:${socket.userId}`);

    // ── WebRTC Signaling ─────────────────────────────────────
    socket.on('join_room', async ({ meetingId, name, profileImage }) => {
        if (!meetingId) return;
        socket.join(`meeting:${meetingId}`);

        if (!meetingRooms.has(meetingId)) meetingRooms.set(meetingId, new Map());
        const room = meetingRooms.get(meetingId);

        const existingPeers = [];
        for (const [sid, info] of room.entries()) {
            existingPeers.push({ socketId: sid, userId: info.userId, name: info.name, profileImage: info.profileImage });
        }

        room.set(socket.id, { userId: socket.userId, name: name || 'User', profileImage: profileImage || null });

        socket.emit('room_peers', { peers: existingPeers });

        socket.to(`meeting:${meetingId}`).emit('peer_joined', {
            socketId: socket.id,
            userId: socket.userId,
            name: name || 'User',
            profileImage: profileImage || null,
        });

        // If transcription is active for this meeting, set up a Sarvam stream for the new joiner
        const session = transcriptionSessions.get(meetingId);
        if (session && session.active) {
            const broadcastSegment = (segment) => {
                io.to(`meeting:${meetingId}`).emit('transcript_update', segment);
            };
            const ws = createSarvamWS(meetingId, socket.id, name || 'User', profileImage || null, broadcastSegment);
            session.speakers.set(socket.id, { ws, name: name || 'User', image: profileImage || null });
            socket.emit('transcription_started', { meetingId });
        }
    });

    socket.on('signal', ({ to, signal }) => {
        io.to(to).emit('signal', { from: socket.id, signal });
    });

    socket.on('leave_room', ({ meetingId }) => {
        if (!meetingId) return;
        socket.leave(`meeting:${meetingId}`);
        const room = meetingRooms.get(meetingId);
        if (room) {
            room.delete(socket.id);
            if (room.size === 0) meetingRooms.delete(meetingId);
        }
        socket.to(`meeting:${meetingId}`).emit('peer_left', { socketId: socket.id });

        const session = transcriptionSessions.get(meetingId);
        if (session && session.speakers.has(socket.id)) {
            const sp = session.speakers.get(socket.id);
            if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
            session.speakers.delete(socket.id);
        }
    });

    // ── Transcription Control ────────────────────────────────
    socket.on('start_transcription', ({ meetingId }) => {
        if (!meetingId) return;
        const room = meetingRooms.get(meetingId);
        if (!room) return;

        const broadcastSegment = (segment) => {
            io.to(`meeting:${meetingId}`).emit('transcript_update', segment);
        };

        const speakers = new Map();
        for (const [sid, info] of room.entries()) {
            const ws = createSarvamWS(meetingId, sid, info.name, info.profileImage, broadcastSegment);
            speakers.set(sid, { ws, name: info.name, image: info.profileImage });
        }

        transcriptionSessions.set(meetingId, { active: true, speakers });
        io.to(`meeting:${meetingId}`).emit('transcription_started', { meetingId });
    });

    socket.on('stop_transcription', ({ meetingId }) => {
        if (!meetingId) return;
        const session = transcriptionSessions.get(meetingId);
        if (session) {
            for (const [, sp] of session.speakers) {
                if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
            }
            session.active = false;
            session.speakers.clear();
        }
        transcriptionSessions.delete(meetingId);
        io.to(`meeting:${meetingId}`).emit('transcription_stopped', { meetingId });
    });

    socket.on('audio_chunk', ({ meetingId, data }) => {
        const session = transcriptionSessions.get(meetingId);
        if (!session || !session.active) return;
        const speaker = session.speakers.get(socket.id);
        if (!speaker || !speaker.ws || speaker.ws.readyState !== WebSocket.OPEN) return;

        try {
            speaker.ws.send(JSON.stringify({
                audio: { data, sample_rate: '16000', encoding: 'audio/wav' },
            }));
        } catch {}
    });

    // ── Meeting room join/leave for transcript sync ──────────
    socket.on('join_meeting', ({ meetingId }) => {
        if (meetingId) socket.join(`meeting:${meetingId}`);
    });

    socket.on('leave_meeting', ({ meetingId }) => {
        if (meetingId) socket.leave(`meeting:${meetingId}`);
    });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.userId);

        for (const [meetingId, room] of meetingRooms.entries()) {
            if (room.has(socket.id)) {
                room.delete(socket.id);
                io.to(`meeting:${meetingId}`).emit('peer_left', { socketId: socket.id });

                const session = transcriptionSessions.get(meetingId);
                if (session && session.speakers.has(socket.id)) {
                    const sp = session.speakers.get(socket.id);
                    if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
                    session.speakers.delete(socket.id);
                }

                if (room.size === 0) {
                    meetingRooms.delete(meetingId);
                    if (session) {
                        for (const [, sp] of session.speakers) {
                            if (sp.ws && sp.ws.readyState === WebSocket.OPEN) sp.ws.close();
                        }
                        transcriptionSessions.delete(meetingId);
                    }
                }
            }
        }
    });
});

function emitToUser(userId, event, data) {
    io.to(`user:${userId.toString()}`).emit(event, data);
}

// ── Email Setup (Nodemailer) ─────────────────────────────────
let transporter = null;

async function getMailTransporter() {
    if (transporter) return transporter;

    if (process.env.SENDGRID_API_KEY) {
        transporter = nodemailer.createTransport({
            host: 'smtp.sendgrid.net',
            port: 587,
            secure: false,
            auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
        });
        console.log('📧 Using SendGrid for email delivery');
    } else if (process.env.SMTP_HOST) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
    } else {
        const testAccount = await nodemailer.createTestAccount();
        transporter = nodemailer.createTransport({
            host: 'smtp.ethereal.email',
            port: 587,
            secure: false,
            auth: { user: testAccount.user, pass: testAccount.pass },
        });
        console.log('📧 Using Ethereal test email — preview URLs in console');
    }
    return transporter;
}

function generateRsvpToken(meetingId, userId) {
    return jwt.sign({ meetingId: meetingId.toString(), userId: userId.toString(), purpose: 'rsvp' }, JWT_SECRET, { expiresIn: '30d' });
}

async function sendRsvpEmail(meeting, user, slot) {
    try {
        const transport = await getMailTransporter();
        const token = generateRsvpToken(meeting._id, user._id);
        const baseUrl = process.env.SERVER_URL || `http://localhost:${PORT}`;

        const makeLink = (response) =>
            `${baseUrl}/api/rsvp/${meeting._id}/respond?token=${token}&response=${response}`;

        const dateStr = slot ? `${slot.date} at ${slot.time}` : `${meeting.date} at ${meeting.time}`;
        const jitsiSection = meeting.jitsiUrl
            ? `<p style="margin:16px 0"><strong>Meeting Link:</strong> <a href="${meeting.jitsiUrl}" style="color:#6366f1">${meeting.jitsiUrl}</a></p>`
            : '';
        const locationSection = meeting.location
            ? `<p><strong>Location:</strong> ${meeting.location}</p>`
            : '';

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a2e">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px">Meeting Invitation</h1>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h2 style="margin:0 0 16px;color:#1a1a2e">${meeting.title}</h2>
    <p><strong>Date/Time:</strong> ${dateStr}</p>
    <p><strong>Type:</strong> ${meeting.modality}</p>
    ${locationSection}
    ${jitsiSection}
    <p style="margin:24px 0 12px;font-weight:600">Will you attend?</p>
    <div style="display:flex;gap:12px">
      <a href="${makeLink('yes')}" style="display:inline-block;padding:10px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Yes</a>
      <a href="${makeLink('no')}" style="display:inline-block;padding:10px 28px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">No</a>
      <a href="${makeLink('maybe')}" style="display:inline-block;padding:10px 28px;background:#f59e0b;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Maybe</a>
    </div>
  </div>
</body>
</html>`;

        const info = await transport.sendMail({
            from: process.env.SMTP_FROM || '"MCMS Platform" <noreply@mcms.app>',
            to: user.email,
            subject: `Meeting Invitation: ${meeting.title}`,
            html,
        });

        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) console.log(`📧 Preview RSVP email for ${user.email}: ${previewUrl}`);
    } catch (err) {
        console.error('Failed to send RSVP email:', err.message);
    }
}

// ─── Auth Helpers ─────────────────────────────────────────────
const generateToken = (id) => {
    return jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });
};
const { protect } = require('./middleware/auth');

// ─── REGISTER ─────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Please provide name, email, and password' });
        }

        if (usingMongo && User) {
            let existing = await User.findOne({ email });
            if (existing) return res.status(400).json({ message: 'User already exists' });
            const user = await User.create({ name, email, password });
            return res.status(201).json({ _id: user._id, name: user.name, email: user.email, token: generateToken(user._id) });
        } else {
            const existing = inMemoryUsers.find(u => u.email === email.toLowerCase());
            if (existing) return res.status(400).json({ message: 'User already exists' });
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            const userId = `user_${Date.now()}`;
            const user = { _id: userId, name, email: email.toLowerCase(), password: hashedPassword };
            inMemoryUsers.push(user);
            return res.status(201).json({ _id: user._id, name: user.name, email: user.email, token: generateToken(user._id) });
        }
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── LOGIN ────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Please provide email and password' });
        }

        if (usingMongo && User) {
            const user = await User.findOne({ email });
            if (!user) return res.status(401).json({ message: 'Invalid email or password' });
            const isMatch = await user.matchPassword(password);
            if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });
            return res.json({ _id: user._id, name: user.name, email: user.email, token: generateToken(user._id) });
        } else {
            const user = inMemoryUsers.find(u => u.email === email.toLowerCase());
            if (!user) return res.status(401).json({ message: 'Invalid email or password' });
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });
            return res.json({ _id: user._id, name: user.name, email: user.email, token: generateToken(user._id) });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── ME ───────────────────────────────────────────────────────
app.get('/api/auth/me', protect, async (req, res) => {
    try {
        if (usingMongo && User) {
            const user = await User.findById(req.user.id).select('-password');
            return res.json(user);
        }
        const user = inMemoryUsers.find(u => u._id === req.user.id);
        res.json(user ? { _id: user._id, name: user.name, email: user.email } : null);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// ─── USER SEARCH (for participant picker) ─────────────────────
app.get('/api/users/search', protect, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (!q || q.length < 2) return res.json([]);

        if (usingMongo && User) {
            const regex = new RegExp(q, 'i');
            const users = await User.find({
                $and: [
                    { _id: { $ne: req.user.id } },
                    { $or: [{ name: regex }, { email: regex }] }
                ]
            }).select('name email').limit(10);
            return res.json(users);
        }

        const lower = q.toLowerCase();
        const results = inMemoryUsers
            .filter(u => u._id !== req.user.id && (u.name.toLowerCase().includes(lower) || u.email.includes(lower)))
            .slice(0, 10)
            .map(u => ({ _id: u._id, name: u.name, email: u.email }));
        res.json(results);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── Mock Data ────────────────────────────────────────────────
const meetings = [
    {
        id: 'mtg-001', title: 'Sprint Planning — Q1 Review', modality: 'Online',
        date: '2026-03-05', time: '10:00 AM', host: 'Dr. Sharma',
        participants: ['Ravi K.', 'Ananya P.', 'Kiran M.', 'Priya S.'], status: 'scheduled',
        jitsiUrl: 'https://meet.jit.si/mcms-sprint-planning',
    },
    {
        id: 'mtg-002', title: 'CS301 — Data Structures Lecture', modality: 'Hybrid',
        date: '2026-03-06', time: '2:00 PM', host: 'Prof. Reddy',
        participants: ['60 students'], status: 'scheduled',
        jitsiUrl: 'https://meet.jit.si/mcms-cs301',
    },
    {
        id: 'mtg-003', title: 'Frontend Candidate Evaluation', modality: 'Online',
        date: '2026-02-28', time: '3:00 PM', host: 'HR Team',
        participants: ['Priya S.', 'Ravi K.'], status: 'completed',
    },
];

const agendas = {
    'mtg-001': [
        { id: 'ag-1', title: 'Review Previous Sprint Goals', duration: 10, status: 'active', notes: '' },
        { id: 'ag-2', title: 'Demo: New Dashboard Module', duration: 15, status: 'pending', notes: '' },
        { id: 'ag-3', title: 'Plan next sprint tasks', duration: 20, status: 'pending', notes: '' },
    ],
};

const transcripts = {
    'mtg-001': [
        { id: 't-1', speaker: 'Dr. Sharma', text: "Let's start with the sprint review.", timestamp: '10:01:12', sentiment: 'neutral', agendaId: 'ag-1' },
        { id: 't-2', speaker: 'Ravi K.', text: 'I completed the QR module integration.', timestamp: '10:03:45', sentiment: 'positive', agendaId: 'ag-1' },
    ],
};

const actionItems = {
    'mtg-001': [
        { id: 'ai-1', title: 'Complete QR module', assignee: 'Ananya P.', category: 'Technical', status: 'in-progress', deadline: '2026-03-08', agendaId: 'ag-1' },
        { id: 'ai-2', title: 'Write unit tests for agenda panel', assignee: 'Kiran M.', category: 'Technical', status: 'pending', deadline: '2026-03-09', agendaId: 'ag-2' },
    ],
};

const dashboardStats = {
    user: 'Kiran M.', role: 'Host', streak: 7, totalMeetings: 42,
    totalHours: 63.5, punctualityRate: 94, tasksCompleted: 28, tasksTotal: 32,
    badges: [
        { name: 'Action Hero', icon: '🏆', description: '90%+ tasks on time' },
        { name: '7-Day Streak', icon: '🔥', description: '7 consecutive on-time meetings' },
    ],
    weeklyHeatmap: [
        { day: 'Mon', hours: 3.5 }, { day: 'Tue', hours: 5.0 }, { day: 'Wed', hours: 2.0 },
        { day: 'Thu', hours: 4.5 }, { day: 'Fri', hours: 3.0 },
    ],
    monthlyAttendance: [{ week: 'W1', attended: 5, total: 6 }, { week: 'W2', attended: 6, total: 6 }],
    sentimentProfile: { positive: 62, neutral: 30, negative: 8 },
    speakingTime: 18.5, avgMeetingDuration: 45,
};

// ─── Protected API Routes ────────────────────────────────────
app.get('/api/meetings', protect, async (req, res) => {
    try {
        if (usingMongo && Meeting) {
            const dbMeetings = await Meeting.find({}).sort({ createdAt: -1 }).populate('participants', 'name email');
            const formatted = dbMeetings.map(m => ({
                id: m._id,
                title: m.title,
                modality: m.modality,
                date: m.confirmedDate || m.date,
                time: m.confirmedTime || m.time,
                location: m.location,
                host: m.host || 'Unknown',
                hostId: m.hostId,
                participants: m.participants,
                status: m.status,
                jitsiUrl: m.jitsiUrl,
                jitsiRoomName: m.jitsiRoomName,
                pollId: m.pollId,
            }));
            return res.json([...formatted, ...meetings]);
        }
        res.json(meetings);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/meetings', protect, async (req, res) => {
    try {
        const { title, modality, timeSlots, location, participants } = req.body;

        const jitsiRoomName = modality !== 'Offline'
            ? `MCMS-${req.user.id.toString().substring(req.user.id.toString().length - 6)}-${Date.now()}`
            : null;
        const jitsiUrl = jitsiRoomName ? `https://meet.jit.si/${jitsiRoomName}` : null;

        let hostName = 'You';
        if (usingMongo && User) {
            const userDoc = await User.findById(req.user.id);
            if (userDoc) hostName = userDoc.name;
        }

        const isSingleSlot = timeSlots && timeSlots.length === 1;

        if (usingMongo && Meeting) {
            const newMeeting = await Meeting.create({
                title,
                modality,
                location: location || null,
                date: isSingleSlot ? timeSlots[0].date : null,
                time: isSingleSlot ? timeSlots[0].time : null,
                confirmedDate: isSingleSlot ? timeSlots[0].date : null,
                confirmedTime: isSingleSlot ? timeSlots[0].time : null,
                host: hostName,
                hostId: req.user.id,
                jitsiUrl,
                jitsiRoomName,
                participants: participants || [],
                status: isSingleSlot ? 'scheduled' : 'pending_poll',
            });

            let pollData = null;

            if (timeSlots && timeSlots.length > 1) {
                const poll = await Poll.create({
                    meetingId: newMeeting._id,
                    slots: timeSlots.map(s => ({ date: s.date, time: s.time, votes: [] })),
                });
                newMeeting.pollId = poll._id;
                await newMeeting.save();
                pollData = { _id: poll._id, slots: poll.slots, status: poll.status };

                if (participants && participants.length > 0) {
                    for (const pid of participants) {
                        const notif = await Notification.create({
                            userId: pid,
                            type: 'poll_invite',
                            meetingId: newMeeting._id,
                            message: `You've been invited to vote on time slots for "${title}"`,
                        });
                        emitToUser(pid, 'notification', {
                            _id: notif._id,
                            type: notif.type,
                            meetingId: newMeeting._id,
                            meetingTitle: title,
                            message: notif.message,
                            read: false,
                            createdAt: notif.createdAt,
                        });
                    }
                }
            }

            if (isSingleSlot && participants && participants.length > 0) {
                const participantDocs = await User.find({ _id: { $in: participants } });
                for (const p of participantDocs) {
                    sendRsvpEmail(newMeeting, p, timeSlots[0]);
                    const notif = await Notification.create({
                        userId: p._id,
                        type: 'meeting_confirmed',
                        meetingId: newMeeting._id,
                        message: `You're invited to "${title}" on ${timeSlots[0].date} at ${timeSlots[0].time}`,
                    });
                    emitToUser(p._id, 'notification', {
                        _id: notif._id,
                        type: notif.type,
                        meetingId: newMeeting._id,
                        meetingTitle: title,
                        message: notif.message,
                        read: false,
                        createdAt: notif.createdAt,
                    });
                }
            }

            const populated = await Meeting.findById(newMeeting._id).populate('participants', 'name email');

            return res.status(201).json({
                id: populated._id,
                title: populated.title,
                modality: populated.modality,
                date: populated.confirmedDate || populated.date,
                time: populated.confirmedTime || populated.time,
                location: populated.location,
                host: populated.host,
                hostId: populated.hostId,
                participants: populated.participants,
                status: populated.status,
                jitsiUrl: populated.jitsiUrl,
                jitsiRoomName: populated.jitsiRoomName,
                pollId: populated.pollId,
                poll: pollData,
            });
        }

        // In-memory fallback
        const slot = isSingleSlot ? timeSlots[0] : null;
        const newMeeting = {
            id: `mtg-${Date.now()}`, title, modality,
            date: slot?.date, time: slot?.time, location,
            host: hostName, participants: participants || [],
            status: isSingleSlot ? 'scheduled' : 'pending_poll',
            jitsiUrl, jitsiRoomName
        };
        meetings.push(newMeeting);
        res.status(201).json(newMeeting);
    } catch (error) {
        console.error('Create meeting error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── POLL ROUTES ──────────────────────────────────────────────
app.get('/api/polls/:meetingId', protect, async (req, res) => {
    try {
        if (!usingMongo || !Poll) return res.json(null);
        const poll = await Poll.findOne({ meetingId: req.params.meetingId });
        if (!poll) return res.status(404).json({ message: 'Poll not found' });

        const meeting = await Meeting.findById(req.params.meetingId).select('title modality jitsiUrl');
        res.json({ ...poll.toObject(), meetingTitle: meeting?.title, modality: meeting?.modality, jitsiUrl: meeting?.jitsiUrl });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/polls/:pollId/vote', protect, async (req, res) => {
    try {
        if (!usingMongo || !Poll) return res.status(400).json({ message: 'Database required' });

        const { slotIndex } = req.body;
        const poll = await Poll.findById(req.params.pollId);
        if (!poll) return res.status(404).json({ message: 'Poll not found' });
        if (poll.status === 'resolved') return res.status(400).json({ message: 'Poll already resolved' });

        const userId = req.user.id;

        // Remove previous vote from any slot
        for (const slot of poll.slots) {
            slot.votes = slot.votes.filter(v => v.toString() !== userId.toString());
        }

        if (slotIndex < 0 || slotIndex >= poll.slots.length) {
            return res.status(400).json({ message: 'Invalid slot index' });
        }

        poll.slots[slotIndex].votes.push(userId);
        await poll.save();

        const meeting = await Meeting.findById(poll.meetingId).populate('participants', 'name email');
        if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

        // +1 for host
        const totalVoters = meeting.participants.length + 1;
        const majority = Math.ceil(totalVoters / 2);

        let resolved = false;
        for (let i = 0; i < poll.slots.length; i++) {
            if (poll.slots[i].votes.length >= majority) {
                poll.status = 'resolved';
                poll.resolvedSlot = i;
                await poll.save();

                const winSlot = poll.slots[i];
                meeting.confirmedDate = winSlot.date;
                meeting.confirmedTime = winSlot.time;
                meeting.date = winSlot.date;
                meeting.time = winSlot.time;
                meeting.status = 'scheduled';
                await meeting.save();

                // Send RSVP emails and notifications to all participants
                for (const p of meeting.participants) {
                    sendRsvpEmail(meeting, p, winSlot);
                    const notif = await Notification.create({
                        userId: p._id,
                        type: 'meeting_confirmed',
                        meetingId: meeting._id,
                        message: `"${meeting.title}" is confirmed for ${winSlot.date} at ${winSlot.time}`,
                    });
                    emitToUser(p._id, 'notification', {
                        _id: notif._id,
                        type: notif.type,
                        meetingId: meeting._id,
                        meetingTitle: meeting.title,
                        message: notif.message,
                        read: false,
                        createdAt: notif.createdAt,
                    });
                }

                // Notify host too
                const hostNotif = await Notification.create({
                    userId: meeting.hostId,
                    type: 'meeting_confirmed',
                    meetingId: meeting._id,
                    message: `Your meeting "${meeting.title}" is confirmed for ${winSlot.date} at ${winSlot.time}`,
                });
                emitToUser(meeting.hostId, 'notification', {
                    _id: hostNotif._id,
                    type: hostNotif.type,
                    meetingId: meeting._id,
                    meetingTitle: meeting.title,
                    message: hostNotif.message,
                    read: false,
                    createdAt: hostNotif.createdAt,
                });

                resolved = true;
                break;
            }
        }

        // Broadcast updated poll to all interested users
        const allUserIds = [meeting.hostId.toString(), ...meeting.participants.map(p => p._id.toString())];
        for (const uid of allUserIds) {
            emitToUser(uid, 'poll_updated', {
                pollId: poll._id,
                meetingId: meeting._id,
                slots: poll.slots,
                status: poll.status,
                resolvedSlot: poll.resolvedSlot,
                resolved,
            });
        }

        res.json({
            poll: poll.toObject(),
            resolved,
            meeting: resolved ? {
                id: meeting._id,
                confirmedDate: meeting.confirmedDate,
                confirmedTime: meeting.confirmedTime,
                jitsiUrl: meeting.jitsiUrl,
            } : null,
        });
    } catch (error) {
        console.error('Vote error:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── NOTIFICATION ROUTES ──────────────────────────────────────
app.get('/api/notifications', protect, async (req, res) => {
    try {
        if (!usingMongo || !Notification) return res.json([]);
        const notifs = await Notification.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('meetingId', 'title');
        res.json(notifs);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.patch('/api/notifications/:id/read', protect, async (req, res) => {
    try {
        if (!usingMongo || !Notification) return res.json({ success: true });
        await Notification.findByIdAndUpdate(req.params.id, { read: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.patch('/api/notifications/read-all', protect, async (req, res) => {
    try {
        if (!usingMongo || !Notification) return res.json({ success: true });
        await Notification.updateMany({ userId: req.user.id, read: false }, { read: true });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// ─── RSVP ROUTES ──────────────────────────────────────────────
app.get('/api/rsvp/:meetingId', protect, async (req, res) => {
    try {
        if (!usingMongo || !RSVP) return res.json([]);
        const rsvps = await RSVP.find({ meetingId: req.params.meetingId }).populate('userId', 'name email');
        res.json(rsvps);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

app.post('/api/rsvp/:meetingId', protect, async (req, res) => {
    try {
        if (!usingMongo || !RSVP) return res.status(400).json({ message: 'Database required' });

        const { response } = req.body;
        if (!['yes', 'no', 'maybe'].includes(response)) {
            return res.status(400).json({ message: 'Invalid response' });
        }

        const rsvp = await RSVP.findOneAndUpdate(
            { meetingId: req.params.meetingId, userId: req.user.id },
            { response, respondedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json(rsvp);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Token-based RSVP from email — no auth required
app.get('/api/rsvp/:meetingId/respond', async (req, res) => {
    try {
        const { token, response } = req.query;
        if (!token || !response || !['yes', 'no', 'maybe'].includes(response)) {
            return res.status(400).send(rsvpPage('Invalid link', '', response));
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.purpose !== 'rsvp' || decoded.meetingId !== req.params.meetingId) {
            return res.status(400).send(rsvpPage('Invalid or expired link', '', response));
        }

        if (usingMongo && RSVP) {
            await RSVP.findOneAndUpdate(
                { meetingId: req.params.meetingId, userId: decoded.userId },
                { response, respondedAt: new Date() },
                { upsert: true, new: true }
            );
        }

        const meeting = usingMongo && Meeting ? await Meeting.findById(req.params.meetingId) : null;
        const title = meeting ? meeting.title : 'Meeting';
        res.send(rsvpPage(`Your response "${response}" has been recorded for`, title, response));
    } catch (error) {
        res.status(400).send(rsvpPage('This link has expired or is invalid', '', ''));
    }
});

function rsvpPage(message, meetingTitle, response) {
    const colorMap = { yes: '#22c55e', no: '#ef4444', maybe: '#f59e0b' };
    const accent = colorMap[response] || '#6366f1';
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RSVP — MCMS</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6">
<div style="background:#fff;padding:40px;border-radius:16px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:420px">
  <div style="width:56px;height:56px;border-radius:50%;background:${accent};margin:0 auto 20px;display:flex;align-items:center;justify-content:center">
    <span style="color:#fff;font-size:24px">${response === 'yes' ? '✓' : response === 'no' ? '✗' : '?'}</span>
  </div>
  <h2 style="margin:0 0 8px;color:#1a1a2e">${message}</h2>
  ${meetingTitle ? `<p style="color:#6366f1;font-weight:600;font-size:18px">${meetingTitle}</p>` : ''}
  <p style="color:#6b7280;margin-top:20px">You can close this tab.</p>
</div></body></html>`;
}

// ─── Existing data routes ─────────────────────────────────────
app.get('/api/agenda/:meetingId', protect, (req, res) => res.json(agendas[req.params.meetingId] || []));
app.get('/api/transcript/:meetingId', protect, async (req, res) => {
    try {
        if (usingMongo && Transcript) {
            const docs = await Transcript.find({ meetingId: req.params.meetingId }).sort({ createdAt: 1 });
            if (docs.length) {
                return res.json(docs.map(d => ({
                    id: d._id,
                    speaker: d.speaker,
                    speakerImage: d.speakerImage,
                    text: d.text,
                    timestamp: d.timestamp,
                    languageCode: d.languageCode,
                    sentiment: d.sentiment,
                })));
            }
        }
        res.json(transcripts[req.params.meetingId] || []);
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err.message });
    }
});
app.get('/api/action-items/:meetingId', protect, (req, res) => res.json(actionItems[req.params.meetingId] || []));

app.get('/api/dashboard/stats', protect, (req, res) => {
    const stats = { ...dashboardStats };
    if (req.user && req.user.name) stats.user = req.user.name;
    res.json(stats);
});

// ─── Serve client build under /mcms (production) ─────────────
const CLIENT_BUILD = path.join(__dirname, '..', 'client', 'dist');
app.use('/mcms', express.static(CLIENT_BUILD));
app.get('/mcms/*', (req, res) => {
    res.sendFile(path.join(CLIENT_BUILD, 'index.html'));
});

// ─── Start Server ────────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`✅ MCMS Backend running at http://localhost:${PORT}`);
    console.log(`   MongoDB: ${usingMongo ? 'Connected' : 'Not running — users stored in-memory (lost on restart)'}`);
});

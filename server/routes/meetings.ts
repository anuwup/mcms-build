import express from 'express';
const router = express.Router();

export = function ({ User, Meeting, Poll, Notification, protect, usingMongo, emitToUser, sendRsvpEmail, generateICS, CLIENT_URL, inMemoryMeetings }: any) {

    router.get('/', protect, async (req: any, res: any) => {
        try {
            if (usingMongo() && Meeting) {
                const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
                const dbMeetings = await Meeting.find({}).sort({ createdAt: -1 }).populate('participants', 'name email');
                const formatted = dbMeetings.map((m: any) => ({
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
                    meetingUrl: m.modality !== 'Offline' ? `${base}?meeting=${m._id}` : null,
                    pollId: m.pollId,
                }));
                return res.json(formatted);
            }
            res.json(inMemoryMeetings);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/', protect, async (req: any, res: any) => {
        try {
            const { title, modality, timeSlots, location, participants } = req.body;

            let hostName = 'You';
            if (usingMongo() && User) {
                const userDoc = await User.findById(req.user.id);
                if (userDoc) hostName = userDoc.name;
            }

            const isSingleSlot = timeSlots && timeSlots.length === 1;

            if (usingMongo() && Meeting) {
                const newMeeting = await Meeting.create({
                    title, modality,
                    location: location || null,
                    date: isSingleSlot ? timeSlots[0].date : null,
                    time: isSingleSlot ? timeSlots[0].time : null,
                    confirmedDate: isSingleSlot ? timeSlots[0].date : null,
                    confirmedTime: isSingleSlot ? timeSlots[0].time : null,
                    host: hostName, hostId: req.user.id,
                    participants: participants || [],
                    status: isSingleSlot ? 'scheduled' : 'pending_poll',
                });
                const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
                const meetingUrl = modality !== 'Offline' ? `${base}?meeting=${newMeeting._id}` : null;

                let pollData: any = null;

                if (timeSlots && timeSlots.length > 1) {
                    const poll = await Poll.create({
                        meetingId: newMeeting._id,
                        slots: timeSlots.map((s: any) => ({ date: s.date, time: s.time, votes: [] })),
                    });
                    newMeeting.pollId = poll._id;
                    await newMeeting.save();
                    pollData = { _id: poll._id, slots: poll.slots, status: poll.status };

                    if (participants && participants.length > 0) {
                        for (const pid of participants) {
                            const notif = await Notification.create({
                                userId: pid, type: 'poll_invite',
                                meetingId: newMeeting._id,
                                message: `You've been invited to vote on time slots for "${title}"`,
                            });
                            emitToUser(pid, 'notification', {
                                _id: notif._id, type: notif.type,
                                meetingId: newMeeting._id, meetingTitle: title,
                                message: notif.message, read: false, createdAt: notif.createdAt,
                            });
                        }
                    }
                }

                if (isSingleSlot && participants && participants.length > 0) {
                    const participantDocs = await User.find({ _id: { $in: participants } });
                    const meetingForIcs = { ...newMeeting.toObject(), meetingUrl };
                    const icsBuffer = generateICS(meetingForIcs, timeSlots[0]);
                    for (const p of participantDocs) {
                        sendRsvpEmail(newMeeting, p, timeSlots[0], icsBuffer);
                        const notif = await Notification.create({
                            userId: p._id, type: 'meeting_confirmed',
                            meetingId: newMeeting._id,
                            message: `You're invited to "${title}" on ${timeSlots[0].date} at ${timeSlots[0].time}`,
                        });
                        emitToUser(p._id, 'notification', {
                            _id: notif._id, type: notif.type,
                            meetingId: newMeeting._id, meetingTitle: title,
                            message: notif.message, read: false, createdAt: notif.createdAt,
                        });
                    }
                }

                const populated = await Meeting.findById(newMeeting._id).populate('participants', 'name email');

                return res.status(201).json({
                    id: populated._id, title: populated.title, modality: populated.modality,
                    date: populated.confirmedDate || populated.date,
                    time: populated.confirmedTime || populated.time,
                    location: populated.location, host: populated.host, hostId: populated.hostId,
                    participants: populated.participants, status: populated.status,
                    meetingUrl,
                    pollId: populated.pollId, poll: pollData,
                });
            }

            const slot = isSingleSlot ? timeSlots[0] : null;
            const meetingId = `mtg-${Date.now()}`;
            const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
            const meetingUrl = modality !== 'Offline' ? `${base}?meeting=${meetingId}` : null;
            const newMeeting = {
                id: meetingId, title, modality,
                date: slot?.date, time: slot?.time, location,
                host: hostName, participants: participants || [],
                status: isSingleSlot ? 'scheduled' : 'pending_poll',
                meetingUrl,
            };
            inMemoryMeetings.push(newMeeting);
            res.status(201).json(newMeeting);
        } catch (error: any) {
            console.error('Create meeting error:', error);
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.get('/:id/calendar', protect, async (req: any, res: any) => {
        try {
            if (!usingMongo() || !Meeting) return res.status(400).json({ message: 'Database required' });
            const meeting = await Meeting.findById(req.params.id);
            if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

            const base = (CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
            const meetingUrl = meeting.modality !== 'Offline' ? `${base}?meeting=${meeting._id}` : null;
            const meetingForIcs = { ...meeting.toObject(), meetingUrl };
            const slot = { date: meeting.confirmedDate || meeting.date, time: meeting.confirmedTime || meeting.time };
            const icsBuffer = generateICS(meetingForIcs, slot);
            res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${meeting.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics"`);
            res.send(icsBuffer);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

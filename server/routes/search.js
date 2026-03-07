const express = require('express');
const router = express.Router();
const Agenda = require('../models/Agenda');
const Transcript = require('../models/Transcript');

module.exports = function ({ Meeting, protect, usingMongo }) {

    router.get('/', protect, async (req, res) => {
        try {
            if (!usingMongo() || !Meeting) return res.json([]);

            const { q } = req.query;
            const query = (q || '').trim();
            if (!query || query.length < 2) return res.json([]);

            const titleFilter = { title: { $regex: query, $options: 'i' } };
            const transcriptMeetingIds = await Transcript.distinct('meetingId', {
                text: { $regex: query, $options: 'i' },
            });
            const agendaMeetingIds = await Agenda.distinct('meetingId', {
                'items.title': { $regex: query, $options: 'i' },
            });

            const allMeetingIds = [...new Set([
                ...transcriptMeetingIds.map(id => id.toString()),
                ...agendaMeetingIds.map(id => id.toString()),
            ])];

            const mongoose = require('mongoose');
            const qOr = [titleFilter];
            if (allMeetingIds.length > 0) {
                qOr.push({ _id: { $in: allMeetingIds.map(id => new mongoose.Types.ObjectId(id)) } });
            }

            const meetings = await Meeting.find({ $or: qOr })
                .sort({ createdAt: -1 })
                .populate('participants', 'name email')
                .limit(20);

            const results = [];
            for (const m of meetings) {
                const matchedTranscripts = await Transcript.find({
                    meetingId: m._id,
                    text: { $regex: query, $options: 'i' },
                }).limit(3).select('text speaker timestamp agendaItemId');

                const agenda = await Agenda.findOne({ meetingId: m._id });
                const matchedAgendaItems = agenda
                    ? agenda.items.filter(i => i.title && i.title.toLowerCase().includes(query.toLowerCase()))
                    : [];

                results.push({
                    id: m._id,
                    title: m.title,
                    modality: m.modality,
                    date: m.confirmedDate || m.date,
                    time: m.confirmedTime || m.time,
                    host: m.host,
                    hostId: m.hostId,
                    status: m.status,
                    participants: m.participants,
                    matchedTranscripts: matchedTranscripts.map(t => ({
                        text: t.text,
                        speaker: t.speaker,
                        timestamp: t.timestamp,
                        agendaItemId: t.agendaItemId,
                    })),
                    matchedAgendaItems: matchedAgendaItems.map(i => ({ id: i.id, title: i.title })),
                });
            }

            res.json(results);
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

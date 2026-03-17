import express from 'express';
import mongoose from 'mongoose';
const router = express.Router();
import Agenda = require('../models/Agenda');
import Transcript = require('../models/Transcript');

export = function ({ Meeting, protect, usingMongo }: any) {

    router.get('/', protect, async (req: any, res: any) => {
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
                ...transcriptMeetingIds.map((id: any) => id.toString()),
                ...agendaMeetingIds.map((id: any) => id.toString()),
            ])];

            const qOr: any[] = [titleFilter];
            if (allMeetingIds.length > 0) {
                qOr.push({ _id: { $in: allMeetingIds.map((id: string) => new mongoose.Types.ObjectId(id)) } });
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
                    ? (agenda as any).items.filter((i: any) => i.title && i.title.toLowerCase().includes(query.toLowerCase()))
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
                    matchedTranscripts: matchedTranscripts.map((t: any) => ({
                        text: t.text,
                        speaker: t.speaker,
                        timestamp: t.timestamp,
                        agendaItemId: t.agendaItemId,
                    })),
                    matchedAgendaItems: matchedAgendaItems.map((i: any) => ({ id: i.id, title: i.title })),
                });
            }

            res.json(results);
        } catch (error: any) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

const express = require('express');
const router = express.Router();
const Transcript = require('../models/Transcript');

module.exports = function ({ protect, usingMongo, inMemoryTranscripts }) {

    router.get('/:meetingId', protect, async (req, res) => {
        try {
            if (usingMongo() && Transcript) {
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
                        agendaItemId: d.agendaItemId,
                    })));
                }
            }
            res.json(inMemoryTranscripts[req.params.meetingId] || []);
        } catch (err) {
            res.status(500).json({ message: 'Server error', error: err.message });
        }
    });

    return router;
};

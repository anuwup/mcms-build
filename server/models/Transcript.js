const mongoose = require('mongoose');

const transcriptSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
    agendaItemId: { type: String, default: null },
    speaker: { type: String, default: 'Unknown' },
    speakerImage: { type: String, default: null },
    text: { type: String, required: true },
    timestamp: { type: String },
    startTime: { type: Number, default: null },
    endTime: { type: Number, default: null },
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative', null], default: null },
    languageCode: { type: String, default: null },
}, {
    timestamps: true,
});

transcriptSchema.index({ meetingId: 1, startTime: 1 });

module.exports = mongoose.model('Transcript', transcriptSchema);

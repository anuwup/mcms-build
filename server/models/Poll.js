const mongoose = require('mongoose');

const pollSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
    slots: [{
        date: { type: String, required: true },
        time: { type: String, required: true },
        votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    }],
    status: { type: String, default: 'active', enum: ['active', 'resolved'] },
    resolvedSlot: { type: Number, default: null },
}, {
    timestamps: true
});

module.exports = mongoose.model('Poll', pollSchema);

const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
    meetingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Meeting',
        required: true,
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    content: {
        type: Object,
        default: null,
    },
}, { timestamps: true });

noteSchema.index({ meetingId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Note', noteSchema);

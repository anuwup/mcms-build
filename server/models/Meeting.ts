import mongoose from 'mongoose';

const meetingSchema = new mongoose.Schema({
    title: { type: String, required: true },
    modality: { type: String, default: 'Online' },
    date: { type: String },
    time: { type: String },
    confirmedDate: { type: String },
    confirmedTime: { type: String },
    location: { type: String },
    host: { type: String },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    pollId: { type: mongoose.Schema.Types.ObjectId, ref: 'Poll' },
    status: { type: String, default: 'pending_poll', enum: ['pending_poll', 'scheduled', 'in-progress', 'completed', 'cancelled'] },
    jitsiUrl: { type: String },
    jitsiRoomName: { type: String },
}, {
    timestamps: true
});

export = mongoose.model('Meeting', meetingSchema);

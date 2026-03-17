import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: [
        'poll_invite', 'meeting_confirmed', 'rsvp_update',
        'attendance_marked', 'action_item_assigned', 'brief_ready',
        'meeting_summary_ready', 'rubric_score',
    ] },
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
}, {
    timestamps: true
});

export = mongoose.model('Notification', notificationSchema);

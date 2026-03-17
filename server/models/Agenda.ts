import mongoose from 'mongoose';

const agendaItemSchema = new mongoose.Schema({
    id: { type: String, required: true },
    title: { type: String, required: true },
    duration: { type: Number, default: 10 },
    status: { type: String, enum: ['pending', 'active', 'paused', 'completed'], default: 'pending' },
    notes: { type: String, default: '' },
    order: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
}, { _id: false });

const agendaSchema = new mongoose.Schema({
    meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true },
    items: [agendaItemSchema],
    activeItemId: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, {
    timestamps: true,
});

export = mongoose.model('Agenda', agendaSchema);

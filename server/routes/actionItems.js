const express = require('express');
const router = express.Router();
const ActionItem = require('../models/ActionItem');

module.exports = function ({ protect, usingMongo, Notification, emitToUser, inMemoryActionItems }) {

    router.get('/:meetingId', protect, async (req, res) => {
        try {
            if (usingMongo() && ActionItem) {
                const items = await ActionItem.find({ meetingId: req.params.meetingId })
                    .populate('assignee', 'name email')
                    .sort({ createdAt: 1 });
                if (items.length) {
                    return res.json(items.map(i => ({
                        id: i._id, title: i.title,
                        assignee: i.assigneeName || i.assignee?.name || 'Unassigned',
                        assigneeId: i.assignee?._id || i.assignee,
                        category: i.category, status: i.status,
                        deadline: i.deadline, agendaItemId: i.agendaItemId,
                        source: i.source, aiConfidence: i.aiConfidence,
                    })));
                }
            }
            res.json(inMemoryActionItems[req.params.meetingId] || []);
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId', protect, async (req, res) => {
        try {
            const { title, assignee, assigneeName, category, status, deadline, agendaItemId, source, aiConfidence } = req.body;

            if (!usingMongo()) {
                const item = {
                    id: `ai-${Date.now()}`, title, assignee: assigneeName || 'Unassigned',
                    category: category || 'Technical', status: status || 'pending',
                    deadline, agendaItemId: agendaItemId || null,
                };
                if (!inMemoryActionItems[req.params.meetingId]) inMemoryActionItems[req.params.meetingId] = [];
                inMemoryActionItems[req.params.meetingId].push(item);
                return res.status(201).json(item);
            }

            const item = await ActionItem.create({
                meetingId: req.params.meetingId,
                title, assignee: assignee || null,
                assigneeName: assigneeName || null,
                category: category || 'Technical',
                status: status || 'pending',
                deadline: deadline || null,
                agendaItemId: agendaItemId || null,
                source: source || 'manual',
                aiConfidence: aiConfidence || null,
            });

            if (assignee && Notification) {
                try {
                    const notif = await Notification.create({
                        userId: assignee, type: 'action_item_assigned',
                        meetingId: req.params.meetingId,
                        message: `You've been assigned: "${title}"`,
                    });
                    emitToUser(assignee, 'notification', {
                        _id: notif._id, type: notif.type,
                        meetingId: req.params.meetingId, message: notif.message,
                        read: false, createdAt: notif.createdAt,
                    });
                } catch (e) { /* non-critical */ }
            }

            res.status(201).json({
                id: item._id, title: item.title,
                assignee: item.assigneeName || 'Unassigned',
                assigneeId: item.assignee,
                category: item.category, status: item.status,
                deadline: item.deadline, agendaItemId: item.agendaItemId,
                source: item.source, aiConfidence: item.aiConfidence,
            });
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/:id', protect, async (req, res) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });

            const updates = {};
            const allowed = ['title', 'assignee', 'assigneeName', 'category', 'status', 'deadline'];
            for (const key of allowed) {
                if (req.body[key] !== undefined) updates[key] = req.body[key];
            }

            const item = await ActionItem.findByIdAndUpdate(req.params.id, updates, { new: true })
                .populate('assignee', 'name email');
            if (!item) return res.status(404).json({ message: 'Action item not found' });

            res.json({
                id: item._id, title: item.title,
                assignee: item.assigneeName || item.assignee?.name || 'Unassigned',
                assigneeId: item.assignee?._id || item.assignee,
                category: item.category, status: item.status,
                deadline: item.deadline, agendaItemId: item.agendaItemId,
                source: item.source, aiConfidence: item.aiConfidence,
            });
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.delete('/:id', protect, async (req, res) => {
        try {
            if (!usingMongo()) return res.status(400).json({ message: 'Database required' });
            await ActionItem.findByIdAndDelete(req.params.id);
            res.json({ message: 'Deleted' });
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

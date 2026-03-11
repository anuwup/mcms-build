const express = require('express');
const router = express.Router();
const Agenda = require('../models/Agenda');

module.exports = function ({ protect, usingMongo, inMemoryAgendas }) {

    router.get('/:meetingId', protect, async (req, res) => {
        try {
            if (usingMongo() && Agenda) {
                const agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
                if (agenda) return res.json(agenda.items);
            }
            res.json(inMemoryAgendas[req.params.meetingId] || []);
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId', protect, async (req, res) => {
        try {
            if (!usingMongo()) {
                const { items } = req.body;
                inMemoryAgendas[req.params.meetingId] = items || [];
                return res.json(items || []);
            }

            const { items } = req.body;
            const agenda = await Agenda.findOneAndUpdate(
                { meetingId: req.params.meetingId },
                { meetingId: req.params.meetingId, items: items || [], createdBy: req.user.id },
                { upsert: true, new: true }
            );
            res.json(agenda.items);
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.post('/:meetingId/items', protect, async (req, res) => {
        try {
            const { title, duration } = req.body;
            const newItem = {
                id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                title: title || 'New Item',
                duration: duration || 10,
                status: 'pending',
                notes: '',
                order: 0,
            };

            if (!usingMongo()) {
                if (!inMemoryAgendas[req.params.meetingId]) inMemoryAgendas[req.params.meetingId] = [];
                newItem.order = inMemoryAgendas[req.params.meetingId].length;
                inMemoryAgendas[req.params.meetingId].push(newItem);
                return res.status(201).json(newItem);
            }

            let agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
            if (!agenda) {
                agenda = await Agenda.create({ meetingId: req.params.meetingId, items: [], createdBy: req.user.id });
            }
            newItem.order = agenda.items.length;
            agenda.items.push(newItem);
            await agenda.save();
            res.status(201).json(newItem);
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    router.put('/:meetingId/items/:itemId', protect, async (req, res) => {
        try {
            const { status, notes, title, duration } = req.body;

            if (!usingMongo()) {
                const items = inMemoryAgendas[req.params.meetingId];
                if (!items) return res.status(404).json({ message: 'Agenda not found' });
                const item = items.find(i => i.id === req.params.itemId);
                if (!item) return res.status(404).json({ message: 'Item not found' });
                if (status !== undefined) item.status = status;
                if (notes !== undefined) item.notes = notes;
                if (title !== undefined) item.title = title;
                if (duration !== undefined) item.duration = duration;
                return res.json(item);
            }

            const agenda = await Agenda.findOne({ meetingId: req.params.meetingId });
            if (!agenda) return res.status(404).json({ message: 'Agenda not found' });

            const item = agenda.items.find(i => i.id === req.params.itemId);
            if (!item) return res.status(404).json({ message: 'Item not found' });

            if (status !== undefined) item.status = status;
            if (notes !== undefined) item.notes = notes;
            if (title !== undefined) item.title = title;
            if (duration !== undefined) item.duration = duration;
            if (status === 'active') item.startedAt = new Date();
            if (status === 'completed') item.completedAt = new Date();

            await agenda.save();
            res.json(item);
        } catch (error) {
            res.status(500).json({ message: 'Server error', error: error.message });
        }
    });

    return router;
};

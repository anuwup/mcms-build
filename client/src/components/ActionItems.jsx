import { useState, useEffect } from 'react';
import Icon from './Icon';
import ShortcutTooltip from './ShortcutTooltip';
import {
    CheckmarkCircle01Icon, Clock01Icon, AlertCircleIcon,
    ArrowRight01Icon, ArrowDown01Icon, ArrowUp01Icon,
    FlashIcon, Add01Icon, Delete02Icon, SparklesIcon,
} from '@hugeicons/core-free-icons';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

const categoryChips = {
    'Technical': 'chip-blue',
    'Administrative': 'chip-purple',
    'Decision': 'chip-amber',
    'Follow-up': 'chip-cyan',
};

const statusConfig = {
    'completed': { icon: CheckmarkCircle01Icon, color: 'var(--accent-emerald)', label: 'Completed' },
    'in-progress': { icon: Clock01Icon, color: 'var(--accent-amber)', label: 'In Progress' },
    'pending': { icon: AlertCircleIcon, color: 'var(--text-muted)', label: 'Pending' },
    'draft': { icon: AlertCircleIcon, color: 'var(--text-tertiary)', label: 'Draft' },
};

const CATEGORIES = ['Technical', 'Administrative', 'Decision', 'Follow-up'];
const STATUSES = ['draft', 'pending', 'in-progress', 'completed'];

export default function ActionItems({ items, meetingId, fetchWithAuth, onRefresh, addActionItemTrigger, onAddTriggered }) {
    const [collapsed, setCollapsed] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [newCategory, setNewCategory] = useState('Technical');
    const [newDeadline, setNewDeadline] = useState('');
    const [editingId, setEditingId] = useState(null);

    useEffect(() => {
        if (addActionItemTrigger && addActionItemTrigger > 0) {
            setAdding(true);
            onAddTriggered?.();
        }
    }, [addActionItemTrigger, onAddTriggered]);

    const handleCreate = async () => {
        if (!newTitle.trim() || !meetingId) return;
        try {
            const res = await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${meetingId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: newTitle.trim(), category: newCategory, deadline: newDeadline || null }),
            });
            if (res.ok) {
                setNewTitle('');
                setNewDeadline('');
                setAdding(false);
                onRefresh?.();
            }
        } catch (err) {
            console.error('Failed to create action item:', err);
        }
    };

    const handleStatusChange = async (itemId, newStatus) => {
        try {
            await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus }),
            });
            onRefresh?.();
        } catch (err) {
            console.error('Failed to update status:', err);
        }
    };

    const handleDelete = async (itemId) => {
        try {
            await (fetchWithAuth || fetch)(`${API_BASE}/action-items/${itemId}`, { method: 'DELETE' });
            onRefresh?.();
        } catch (err) {
            console.error('Failed to delete:', err);
        }
    };

    return (
        <div className="action-items-section">
            <div className="section-header collapsible-header" style={{ borderTop: '0.0625rem solid var(--border)' }} onClick={() => setCollapsed(c => !c)}>
                <div className="section-title-container">
                    <Icon icon={FlashIcon} size={14} />
                    <span className="section-title">Action Items</span>
                    <span className="chip chip-blue">{items.length}</span>
                </div>
                <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
            </div>

            <div className={`collapsible-body ${collapsed ? 'collapsed' : ''}`}>
                <div className="collapsible-body-inner">
                <div className="action-items-list">
                    {items.map((item, index) => {
                        const status = statusConfig[item.status] || statusConfig.pending;
                        const isEditing = editingId === (item.id || item._id);

                        return (
                            <div
                                key={item.id || item._id || index}
                                className="action-item-card glass-card animate-in"
                                style={{ animationDelay: `${index * 0.06}s` }}
                            >
                                <div className="ai-card-top">
                                    <Icon icon={status.icon} size={16} style={{ color: status.color, flexShrink: 0 }} />
                                    <span className="ai-card-title">{item.title}</span>
                                    {item.source === 'ai-extracted' && (
                                        <span className="chip chip-purple" style={{ fontSize: '0.5625rem', padding: '1px 5px' }}>
                                            <Icon icon={SparklesIcon} size={8} /> AI
                                        </span>
                                    )}
                                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '2px' }}>
                                        {isEditing ? (
                                            <select
                                                className="input-field"
                                                style={{ fontSize: '0.625rem', padding: '2px 4px', width: 'auto' }}
                                                value={item.status}
                                                onChange={(e) => { handleStatusChange(item.id || item._id, e.target.value); setEditingId(null); }}
                                            >
                                                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                                            </select>
                                        ) : (
                                            <button
                                                className="btn-icon btn-icon-sm"
                                                style={{ fontSize: '0.5rem' }}
                                                onClick={() => setEditingId(item.id || item._id)}
                                                title="Change status"
                                            >
                                                <Icon icon={Clock01Icon} size={10} />
                                            </button>
                                        )}
                                        {meetingId && (
                                            <button
                                                className="btn-icon btn-icon-sm"
                                                onClick={() => handleDelete(item.id || item._id)}
                                                title="Delete"
                                            >
                                                <Icon icon={Delete02Icon} size={10} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="ai-card-meta">
                                    <span className={`chip ${categoryChips[item.category] || 'chip-blue'}`}>
                                        {item.category}
                                    </span>
                                    <span className="ai-card-assignee">
                                        <Icon icon={ArrowRight01Icon} size={10} />
                                        {item.assignee || 'Unassigned'}
                                    </span>
                                    {item.deadline && (
                                        <span className="ai-card-deadline">
                                            <Icon icon={Clock01Icon} size={10} />
                                            {item.deadline}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {adding ? (
                        <div className="glass-card inline-form-card" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); } }}>
                            <input
                                className="input-field"
                                placeholder="Action item title..."
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreate();
                                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); }
                                }}
                                autoFocus
                                style={{ marginBottom: '0.25rem' }}
                            />
                            <div className="inline-form-row">
                                <select
                                    className="input-field"
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                >
                                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <input
                                    type="date"
                                    className="input-field"
                                    value={newDeadline}
                                    onChange={(e) => setNewDeadline(e.target.value)}
                                />
                                <button className="btn btn-sm btn-primary" onClick={handleCreate}>Add</button>
                                <button className="btn btn-sm btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
                            </div>
                        </div>
                    ) : (
                        meetingId && (
                            <ShortcutTooltip keys={['Shift', 'A']} position="top" fullWidth>
                                <button
                                    className="btn btn-secondary"
                                    style={{ margin: '0 var(--lk-size-sm)', width: 'calc(100% - 2 * var(--lk-size-sm))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    onClick={() => setAdding(true)}
                                >
                                    <Icon icon={Add01Icon} size={16} /> Add Action Item
                                </button>
                            </ShortcutTooltip>
                        )
                    )}
                </div>
                </div>
            </div>
        </div>
    );
}

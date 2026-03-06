import { useState } from 'react';
import Icon from './Icon';
import { CheckmarkCircle01Icon, Clock01Icon, AlertCircleIcon, ArrowRight01Icon, ArrowDown01Icon, ArrowUp01Icon, FlashIcon } from '@hugeicons/core-free-icons';

const categoryChips = {
    'Technical': 'chip-blue',
    'Administrative': 'chip-violet',
    'Decision': 'chip-amber',
    'Follow-up': 'chip-cyan',
};

const statusConfig = {
    'completed': { icon: CheckmarkCircle01Icon, color: 'var(--accent-emerald)', label: 'Completed' },
    'in-progress': { icon: Clock01Icon, color: 'var(--accent-amber)', label: 'In Progress' },
    'pending': { icon: AlertCircleIcon, color: 'var(--text-muted)', label: 'Pending' },
};

export default function ActionItems({ items }) {
    const [collapsed, setCollapsed] = useState(false);

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

            {!collapsed && (
                <div className="action-items-list">
                    {items.map((item, index) => {
                        const status = statusConfig[item.status] || statusConfig.pending;

                        return (
                            <div
                                key={item.id}
                                className="action-item-card glass-card animate-in"
                                style={{ animationDelay: `${index * 0.06}s` }}
                                id={`action-item-${item.id}`}
                            >
                                <div className="ai-card-top">
                                    <Icon icon={status.icon} size={16} style={{ color: status.color, flexShrink: 0 }} />
                                    <span className="ai-card-title">{item.title}</span>
                                </div>

                                <div className="ai-card-meta">
                                    <span className={`chip ${categoryChips[item.category] || 'chip-blue'}`}>
                                        {item.category}
                                    </span>
                                    <span className="ai-card-assignee">
                                        <Icon icon={ArrowRight01Icon} size={10} />
                                        {item.assignee}
                                    </span>
                                    <span className="ai-card-deadline">
                                        <Icon icon={Clock01Icon} size={10} />
                                        {item.deadline}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

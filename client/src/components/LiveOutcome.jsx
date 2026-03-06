import { useState } from 'react';
import Icon from './Icon';
import { Target01Icon, Alert01Icon, ChartIncreaseIcon, ArrowDown01Icon, ArrowUp01Icon, EyeIcon } from '@hugeicons/core-free-icons';

export default function LiveOutcome() {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div className="live-outcome">
            <div className="section-header collapsible-header" style={{ borderTop: '0.0625rem solid var(--border)' }} onClick={() => setCollapsed(c => !c)}>
                <div className="section-title-container">
                    <Icon icon={EyeIcon} size={14} />
                    <span className="section-title">Live Outcome Preview</span>
                    <span className="chip chip-violet" style={{ fontSize: '0.625rem' }}>DOPPELGANGER</span>
                </div>
                <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
            </div>

            {!collapsed && (
                <div className="outcome-content">
                    <div className="outcome-score">
                        <div className="score-circle">
                            <svg width="64" height="64" viewBox="0 0 64 64">
                                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                                <circle
                                    cx="32" cy="32" r="28" fill="none"
                                    stroke="url(#scoreGrad)" strokeWidth="4"
                                    strokeDasharray={`${0.72 * 2 * Math.PI * 28} ${2 * Math.PI * 28}`}
                                    strokeLinecap="round"
                                    transform="rotate(-90 32 32)"
                                    style={{ transition: 'stroke-dasharray 1s ease' }}
                                />
                                <defs>
                                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                                        <stop stopColor="#4F8EF7" />
                                        <stop offset="1" stopColor="#34D399" />
                                    </linearGradient>
                                </defs>
                            </svg>
                            <span className="score-value">72%</span>
                        </div>
                        <div className="score-details">
                            <div className="score-label">Outcome Quality</div>
                            <div className="score-desc">Based on agenda coverage & decisions</div>
                        </div>
                    </div>

                    <div className="outcome-items">
                        <div className="outcome-item">
                            <Icon icon={Target01Icon} size={14} style={{ color: 'var(--accent-emerald)' }} />
                            <span>2 of 5 agenda items addressed</span>
                        </div>
                        <div className="outcome-item">
                            <Icon icon={ChartIncreaseIcon} size={14} style={{ color: 'var(--primary)' }} />
                            <span>3 action items extracted so far</span>
                        </div>
                        <div className="outcome-item">
                            <Icon icon={Alert01Icon} size={14} style={{ color: 'var(--accent-amber)' }} />
                            <span>3 topics still unaddressed</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

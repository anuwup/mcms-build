import { useState, useMemo } from 'react';
import Icon from './Icon';
import { Target01Icon, Alert01Icon, ChartIncreaseIcon, ArrowDown01Icon, ArrowUp01Icon, EyeIcon } from '@hugeicons/core-free-icons';

interface LiveOutcomeProps {
    agendaItems?: Array<{ id: string; status: string }>;
    actionItems?: Array<{ category?: string }>;
    transcripts?: any[];
}

export default function LiveOutcome({ agendaItems = [], actionItems = [], transcripts = [] }: LiveOutcomeProps) {
    const [collapsed, setCollapsed] = useState(false);

    const stats = useMemo(() => {
        const totalAgenda = agendaItems.length;
        const addressedAgenda = agendaItems.filter(i => i.status === 'completed' || i.status === 'active').length;
        const unaddressed = totalAgenda - addressedAgenda;
        const aiCount = actionItems.length;

        const coverage = totalAgenda > 0 ? Math.round((addressedAgenda / totalAgenda) * 100) : 0;
        const hasTranscripts = transcripts.length > 0;
        const decisionItems = actionItems.filter(i => i.category === 'Decision').length;

        let qualityScore = 0;
        if (totalAgenda > 0) qualityScore += (addressedAgenda / totalAgenda) * 50;
        if (aiCount > 0) qualityScore += Math.min(aiCount * 10, 30);
        if (hasTranscripts) qualityScore += 20;
        qualityScore = Math.min(100, Math.round(qualityScore));

        return { totalAgenda, addressedAgenda, unaddressed, aiCount, qualityScore, decisionItems };
    }, [agendaItems, actionItems, transcripts]);

    const circumference = 2 * Math.PI * 28;
    const dashLength = (stats.qualityScore / 100) * circumference;

    return (
        <div className="live-outcome">
            <div className="section-header collapsible-header" onClick={() => setCollapsed(c => !c)}>
                <div className="section-title-container">
                    <Icon icon={EyeIcon} size={14} />
                    <span className="section-title">Live Outcome Preview</span>
                    <span className="chip chip-purple">DOPPELGANGER</span>
                </div>
                <Icon icon={collapsed ? ArrowDown01Icon : ArrowUp01Icon} size={14} />
            </div>

            <div className={`collapsible-body ${collapsed ? 'collapsed' : ''}`}>
                <div className="collapsible-body-inner">
                <div className="outcome-content">
                    <div className="outcome-score">
                        <div className="score-circle">
                            <svg width="64" height="64" viewBox="0 0 64 64">
                                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                                <circle
                                    cx="32" cy="32" r="28" fill="none"
                                    stroke="url(#scoreGrad)" strokeWidth="4"
                                    strokeDasharray={`${dashLength} ${circumference}`}
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
                            <span className="score-value">{stats.qualityScore}%</span>
                        </div>
                        <div className="score-details">
                            <div className="score-label">Outcome Quality</div>
                            <div className="score-desc">Based on agenda coverage & decisions</div>
                        </div>
                    </div>

                    <div className="outcome-items">
                        <div className="outcome-item">
                            <Icon icon={Target01Icon} size={14} style={{ color: 'var(--accent-emerald)' }} />
                            <span>{stats.addressedAgenda} of {stats.totalAgenda} agenda items addressed</span>
                        </div>
                        <div className="outcome-item">
                            <Icon icon={ChartIncreaseIcon} size={14} style={{ color: 'var(--primary)' }} />
                            <span>{stats.aiCount} action item{stats.aiCount !== 1 ? 's' : ''} extracted so far</span>
                        </div>
                        {stats.unaddressed > 0 && (
                            <div className="outcome-item">
                                <Icon icon={Alert01Icon} size={14} style={{ color: 'var(--accent-amber)' }} />
                                <span>{stats.unaddressed} topic{stats.unaddressed !== 1 ? 's' : ''} still unaddressed</span>
                            </div>
                        )}
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
}

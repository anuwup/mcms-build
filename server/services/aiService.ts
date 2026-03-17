const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

async function callAISummarize(transcriptSegments: any[], agendaItems: any[]) {
    try {
        const resp = await fetch(`${AI_SERVICE_URL}/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: transcriptSegments, agenda_items: agendaItems }),
        });
        if (!resp.ok) throw new Error(`AI service returned ${resp.status}`);
        const data: any = await resp.json();
        return data.summaries || {};
    } catch (error: any) {
        console.error('AI summarize call failed:', error.message);
        throw error;
    }
}

async function callAIExtractActions(transcriptText: string) {
    try {
        const resp = await fetch(`${AI_SERVICE_URL}/extract-actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: transcriptText }),
        });
        if (!resp.ok) throw new Error(`AI service returned ${resp.status}`);
        const data: any = await resp.json();
        return data.actions || [];
    } catch (error: any) {
        console.error('AI extract-actions call failed:', error.message);
        throw error;
    }
}

async function callAISentiment(text: string) {
    try {
        const resp = await fetch(`${AI_SERVICE_URL}/sentiment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        if (!resp.ok) throw new Error(`AI service returned ${resp.status}`);
        return await resp.json();
    } catch (error: any) {
        console.error('AI sentiment call failed:', error.message);
        throw error;
    }
}

export { callAISummarize, callAIExtractActions, callAISentiment };

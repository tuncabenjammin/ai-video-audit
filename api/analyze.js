export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = { ...req.body };
    const messages = [...(body.messages || [])];

    for (let turn = 1; turn <= 5; turn++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ ...body, messages }),
      });

      const data = await response.json();
      const stopReason = data.stop_reason;
      const blockTypes = (data.content || []).map(b => b.type);
      console.log(`[turn ${turn}] status=${response.status} stop_reason=${stopReason} blocks=${JSON.stringify(blockTypes)}`);

      if (!response.ok) {
        console.error(`[turn ${turn}] error body:`, JSON.stringify(data));
        return res.status(response.status).json(data);
      }

      if (stopReason === 'end_turn') {
        return res.status(200).json(data);
      }

      if (stopReason === 'tool_use') {
        messages.push({ role: 'assistant', content: data.content });
        const toolResults = (data.content || [])
          .filter(b => b.type === 'tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
        messages.push({ role: 'user', content: toolResults });
      } else {
        return res.status(200).json(data);
      }
    }

    return res.status(500).json({ error: 'Max turns reached without end_turn' });
  } catch (e) {
    console.error('[analyze] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

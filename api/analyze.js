export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { name, email, website, ...claudeBody } = req.body;
    claudeBody.max_tokens = 2000;
    const messages = [...(claudeBody.messages || [])];

    for (let turn = 1; turn <= 5; turn++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ ...claudeBody, messages }),
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
        try {
          const textBlock = (data.content || []).filter(b => b.type === 'text').pop();
          if (textBlock) {
            const firstBrace = textBlock.text.indexOf('{');
            const lastBrace = textBlock.text.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
              const parsed = JSON.parse(textBlock.text.substring(firstBrace, lastBrace + 1));
              await fetch(`${process.env.SUPABASE_URL}/rest/v1/ai_video_audit_leads`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': process.env.SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
                  'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                  name: req.body.name || '',
                  email: req.body.email || '',
                  website: req.body.website || '',
                  score: parsed.score || null,
                  ai_video_type: parsed.ai_video_type || null,
                  summary: parsed.summary || null
                })
              });
            }
          }
        } catch (supabaseErr) {
          console.error('[analyze] Supabase save error:', supabaseErr.message);
          // Don't fail the request if Supabase save fails
        }
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

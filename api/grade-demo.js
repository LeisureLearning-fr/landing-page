// api/grade-demo.js
// Vercel serverless function — grades the 3 fixed demo questions using the
// Claude API. The API key lives only in Vercel's environment variables
// (Project → Settings → Environment Variables → ANTHROPIC_API_KEY),
// never in this file or in the browser.

const DEMO_QUESTIONS = {
  narrow: {
    label: "Narrow — the Check stage",
    text: "Explain the purpose of the 'Check' stage in a health and safety management system based on the Plan-Do-Check-Act cycle.",
    criteria: `
Key points a strong answer should cover:
- Identifies that 'Check' means monitoring and measuring H&S performance against the objectives/standards set at the 'Plan' stage.
- Distinguishes active monitoring (proactive — inspections, audits, checking before something goes wrong) from reactive monitoring (investigating incidents, ill-health, near misses after something has gone wrong).
- Explains that Check is how an organisation verifies whether the controls put in place during 'Do' are actually working in practice, not just present on paper.
- Mentions methods: audits, inspections, incident/accident investigation, analysis of leading and lagging indicators.
- Links Check to feeding findings into 'Act' — informing corrective action, review of policy/arrangements, continuous improvement.
Suggested scale: mark out of 6, roughly one point per bullet above (max 6).`.trim()
  },
  broad: {
    label: "Broad — safety culture",
    text: "Explain how an organisation can assess the current state of its safety culture and then take steps to improve it.",
    criteria: `
Key points a strong answer should cover:
Assessing current state:
- Safety culture/climate surveys to gauge employee perceptions and attitudes.
- Reviewing incident, accident and near-miss data and trends (lagging indicators).
- Audits and inspections — compliance with procedures (leading indicators).
- Observing behaviours (behavioural safety observation).
- Benchmarking against a safety culture maturity model (e.g. pathological → reactive → calculative → proactive → generative).
- Consulting the workforce — focus groups, safety committee feedback.
Improving it:
- Visible, active senior management commitment and leadership.
- Effective two-way communication and worker consultation.
- Training and competence development.
- Clear roles, responsibilities and accountability.
- Encouraging no-blame near-miss and incident reporting.
- Recognition of good safety behaviour.
- Repeating surveys/monitoring over time to track whether the culture is actually improving.
Suggested scale: mark out of 10, roughly one point per distinct idea covered from either half (max 10). A good answer should address both halves — assessing AND improving — not just one.`.trim()
  },
  exam: {
    label: "Exam level — human reliability",
    text: "Outline EIGHT organisational factors that can influence human reliability in the workplace.",
    criteria: `
Key points — candidate should identify and briefly outline (not just list) any EIGHT of:
- Working hours / shift patterns (fatigue from long shifts or night work).
- Staffing levels / workload (understaffing leading to work overload and time pressure).
- Communication systems (poor handover or communication between shifts/departments increasing error).
- Organisational / safety culture (attitude toward safety shaping individual behaviour).
- Adequacy of procedures and safe systems of work, including permit-to-work systems.
- Training, competence and supervision provided by the organisation.
- Management commitment, leadership and resources allocated to safety.
- Job/task design and environmental factors set by the organisation (ergonomics, noise, temperature).
- Organisational change or restructuring (uncertainty, unfamiliar processes increasing error risk).
- Industrial relations / relationship between workforce and management.
Suggested scale: mark out of 16 — up to 2 marks per factor (1 for correctly identifying it, 1 for a genuine brief outline rather than just naming it), capped at 8 factors.`.trim()
  }
};

const SYSTEM_INSTRUCTIONS = `
You are grading a candidate's answer to a NEBOSH IGC-style health and safety question, for a free interactive demo of an exam-prep tool. Your tone is direct, encouraging and professional — like a supportive tutor, not harsh, not vague praise either.

Below are the three demo questions and their marking criteria. Only grade the ONE question specified in the user's message, using its own criteria — ignore the other two.

${Object.entries(DEMO_QUESTIONS).map(([id, q]) => `--- Question "${id}": ${q.text}\n${q.criteria}`).join('\n\n')}

Respond with ONLY a single JSON object, no other text, no markdown fences, in exactly this shape:
{
  "marks_awarded": <number>,
  "marks_total": <number>,
  "points_covered": [<short strings, each a key point the candidate did address>],
  "points_missed": [<short strings, each a key point the candidate did not address>],
  "feedback": "<2-3 sentences of specific, constructive feedback on how to strengthen the answer>"
}
`.trim();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { questionId, answer } = req.body || {};

  if (!questionId || !DEMO_QUESTIONS[questionId]) {
    res.status(400).json({ error: 'Unknown or missing questionId.' });
    return;
  }
  if (!answer || typeof answer !== 'string' || !answer.trim()) {
    res.status(400).json({ error: 'Answer is empty.' });
    return;
  }
  if (answer.length > 3000) {
    res.status(400).json({ error: 'Answer too long for the demo — keep it under 3000 characters.' });
    return;
  }

  const question = DEMO_QUESTIONS[questionId];

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        system: [
          {
            type: 'text',
            text: SYSTEM_INSTRUCTIONS,
            // Shared across all 3 demo questions and every visitor — identical
            // text each call, so this is the block worth marking cacheable.
            // Note: Haiku 4.5's minimum cacheable block is 4,096 tokens; if this
            // combined block is shorter than that, the marker is harmlessly
            // ignored and you just pay standard input pricing (still cheap).
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [
          {
            role: 'user',
            content: `Grade this candidate's answer to the "${questionId}" question ("${question.text}").\n\nCandidate's answer:\n${answer.trim()}\n\nRespond with only the JSON object.`
          }
        ]
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Claude API error:', apiRes.status, errText);
      res.status(502).json({ error: 'Grading service is temporarily unavailable — please try again in a moment.' });
      return;
    }

    const data = await apiRes.json();
    const rawText = (data.content || []).map((b) => b.text || '').join('').trim();

    let parsed;
    try {
      const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse grading response:', rawText);
      res.status(502).json({ error: 'Could not parse grading result — please try again.' });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    console.error('Grading request failed:', err);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
};

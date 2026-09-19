const requests = new Map();
const WINDOW_MS = 10 * 60_000;
const LIMIT = 5;
const COOLDOWN_MS = 8_000;
const DAILY_LIMIT = 60;

const portfolioContext = `You are the concise guide for Ifedayo Otegbola's portfolio. Answer only from this context. Do not invent metrics, claim financial performance, expose secrets, provide trading advice, or discuss personal information beyond this portfolio.

Projects: GradeIQ is a live academic-planning web product. Brain MRI Classifier is a completed TensorFlow/EfficientNetB0 evaluation project for four MRI classes. CropCompass is an agritech harvest-timing decision-support product in development for South-West Nigerian smallholder farmers. Polymarket Trading System is active private market research and execution tooling. ETH Signal Agent is a Ritual Chain testnet learning project; it does not trade or custody funds. Bayse BTC Research Bot is in observation phase and separates observation, paper, and live workflows. Bybit Spot Trading Bot is in demo validation with paper workflows and safety controls.

If a question cannot be answered from this context, say that briefly and invite the visitor to email funto0707@gmail.com. Keep answers under 90 words.`;

function rateLimitKey(ip) {
  return `portfolio-assistant:rate:${ip}:${Math.floor(Date.now() / WINDOW_MS)}`;
}

async function incrementUpstash(key, ttlSeconds) {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!baseUrl || !token) return null;
  const headers = { Authorization: `Bearer ${token}` };
  const increment = await fetch(`${baseUrl}/incr/${encodeURIComponent(key)}`, { headers });
  if (!increment.ok) throw new Error('Rate-limit store unavailable');
  const { result } = await increment.json();
  if (result === 1) await fetch(`${baseUrl}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, { headers });
  return result;
}

async function isRateLimited(ip) {
  const now = Date.now();
  const recent = (requests.get(ip) || []).filter(time => now - time < WINDOW_MS);
  if (recent.length && now - recent.at(-1) < COOLDOWN_MS) return 'cooldown';
  recent.push(now);
  requests.set(ip, recent);
  if (recent.length > LIMIT) return 'window';

  try {
    const windowCount = await incrementUpstash(rateLimitKey(ip), Math.ceil(WINDOW_MS / 1000));
    const day = new Date().toISOString().slice(0, 10);
    const dailyCount = await incrementUpstash(`portfolio-assistant:daily:${day}`, 86_400);
    if (windowCount !== null && windowCount > LIMIT) return 'window';
    if (dailyCount !== null && dailyCount > DAILY_LIMIT) return 'daily';
  } catch {
    // The per-instance in-memory limiter remains active if the optional store is unavailable.
  }
  return null;
}

export async function POST(request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown';
  const limitState = await isRateLimited(ip);
  if (limitState) {
    const error = limitState === 'daily'
      ? 'The assistant has reached its daily request limit. Please try again tomorrow.'
      : limitState === 'cooldown'
        ? 'Please wait a few seconds before asking another question.'
        : 'This assistant allows up to five questions per ten minutes per visitor.';
    return Response.json({ error }, { status: 429, headers: { 'Retry-After': limitState === 'cooldown' ? '8' : '600' } });
  }

  let question;
  try {
    ({ question } = await request.json());
  } catch {
    return Response.json({ error: 'Please send a valid question.' }, { status: 400 });
  }
  if (typeof question !== 'string' || !question.trim() || question.length > 280) {
    return Response.json({ error: 'Questions must be between 1 and 280 characters.' }, { status: 400 });
  }
  if (!process.env.VYCE_API_KEY || !process.env.VYCE_API_BASE_URL) {
    return Response.json({ error: 'Assistant is not configured.' }, { status: 503 });
  }

  try {
    const baseUrl = process.env.VYCE_API_BASE_URL.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.VYCE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VYCE_MODEL || 'deepseek-v4-flash',
        messages: [{ role: 'system', content: portfolioContext }, { role: 'user', content: question.trim() }],
        max_tokens: 150,
        temperature: 0.35
      })
    });
    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content;
    if (!response.ok || !answer) throw new Error('Vyce response failed');
    return Response.json({ answer });
  } catch {
    return Response.json({ error: 'Assistant is temporarily unavailable.' }, { status: 502 });
  }
}

const requests = new Map();
const WINDOW_MS = 10 * 60_000;
const LIMIT = 5;
const COOLDOWN_MS = 8_000;
const DAILY_LIMIT = 60;

const portfolioContext = `You are the concise guide for Ifedayo Otegbola's portfolio. Answer only from the portfolio dossier provided in this prompt. Be specific: identify the mechanism, implementation choice, project stage, or limitation that directly answers the visitor. Do not invent metrics, claim financial performance, expose secrets, provide trading advice, or discuss personal information beyond this portfolio. If a question cannot be answered from the dossier, say that briefly and invite the visitor to email funto0707@gmail.com. Keep answers under 90 words.`;

const projectDossiers = {
  gradeiq: `GradeIQ — live academic-planning web product. It helps students track semesters, calculate CGPA outcomes, plan target grades, and use a serverless integration layer. Role: product design, frontend implementation, integrations.`,
  'brain-mri': `Brain MRI Classifier — completed transfer-learning evaluation project. It recognises four classes: glioma, meningioma, no tumor, and pituitary. It uses TensorFlow/Keras with EfficientNetB0, a 7,200-image project dataset, and retained training/evaluation artefacts. The reported test accuracy on that project dataset is 92%; it is an evaluation project, not a clinical diagnostic product.`,
  cropcompass: `CropCompass — in-development agritech decision-support product for South-West Nigerian smallholder farmers. It helps decide when to sell a harvest. It uses commodity-price history to model sell windows, price uncertainty, yield uncertainty, storage costs, farmgate margins, and confidence ranges rather than a single guaranteed price. It currently supports cassava, maize, plantain, tomato, and yam.`,
  polymarket: `Polymarket Trading System — deployed and operational ETH 5-minute prediction-market bot, used repeatedly in real deployment. It monitors live ETH market inputs and Polymarket CLOB markets, estimates a resolution probability using momentum and volatility context, blends the model estimate with market pricing, and measures the gap against executable prices. It ranks candidate markets with momentum, direction, volume, ATR, edge, and time-to-expiry factors. Before an order it checks the trading window, price bounds, available liquidity, quote freshness, spread, risk state, and position constraints. It uses mean-reversion inversion and trades the NO side when its conditions pass. It includes signed CLOB execution, position monitoring, exits, settlement handling, reconciliation, append-only diagnostics, and risk controls. Do not claim profitability, reveal thresholds/credentials, or give trading advice.`,
  'eth-agent': `ETH Signal Agent — Ritual Chain testnet learning project. A Solidity contract stores an ETH mean-reversion signal based on a five-price rolling average. Scheduled HTTP and LLM callbacks fetch ETH price data and generate a short rationale. It is testnet-only, does not trade, and does not custody funds.`,
  bayse: `Bayse BTC Research Bot — observation-phase, fail-closed research system for NGN-denominated BTC binary markets. Observation mode only discovers and evaluates. Paper mode records conservative simulated trades; live mode requires explicit credentials and a separate enablement flag. It uses append-only JSONL logs and persists state so runs can be audited. It makes no profitability claim.`,
  bybit: `Bybit Spot Trading Bot — demo-validation automated spot-trading system for Bybit V5. It uses a defined EMA/RSI strategy: it looks for a fast EMA above the slow EMA with RSI below the configured overbought threshold, then exits on take-profit, stop-loss, or an EMA trend reversal. It includes a local paper broker, a Bybit Demo Trading path, historical backtests, API/accounting/strategy tests, and explicit flags that prevent live execution by default. It is not represented as profitable or production-ready.`
};

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
  let projectId;
  try {
    ({ question, projectId } = await request.json());
  } catch {
    return Response.json({ error: 'Please send a valid question.' }, { status: 400 });
  }
  if (typeof question !== 'string' || !question.trim() || question.length > 280) {
    return Response.json({ error: 'Questions must be between 1 and 280 characters.' }, { status: 400 });
  }

  const projectContext = typeof projectId === 'string' && projectDossiers[projectId]
    ? `\n\nSelected project dossier:\n${projectDossiers[projectId]}`
    : `\n\nPortfolio overview:\n${Object.values(projectDossiers).join('\n\n')}`;
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
        messages: [{ role: 'system', content: `${portfolioContext}${projectContext}` }, { role: 'user', content: question.trim() }],
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

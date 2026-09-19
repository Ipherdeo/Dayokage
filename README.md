# Ifedayo Otegbola Portfolio

Static portfolio site deployed on Vercel, with a server-side Vyce AI assistant.

## Deploy on Vercel

Import the GitHub repository into Vercel. The static site is served from the repository root and `api/portfolio-assistant.mjs` becomes the assistant endpoint at `/api/portfolio-assistant`.

Before making the first production deployment public, replace the remaining `https://dayokage.netlify.app/` canonical, Open Graph, schema, and sitemap URLs with the final Vercel or custom-domain URL. Do not guess this URL before Vercel assigns it.

Set these environment variables in **Project Settings → Environment Variables**. Add them to both **Production** and **Preview** if you want the assistant available in preview deployments.

| Variable | Value |
| --- | --- |
| `VYCE_API_KEY` | Your Vyce API key — mark as Sensitive. |
| `VYCE_API_BASE_URL` | The OpenAI-compatible base URL from your Vyce dashboard, without `/chat/completions`. |
| `VYCE_MODEL` | `deepseek-v4-flash` unless Vyce specifies a different model ID. |
| `UPSTASH_REDIS_REST_URL` | Optional but recommended shared rate-limit store URL. |
| `UPSTASH_REDIS_REST_TOKEN` | Optional but recommended shared rate-limit store token — mark as Sensitive. |

Do not place API keys in `index.html`, committed `.env` files, GitHub Actions secrets for this site, or browser-side variables. Changing an environment variable requires a new deployment.

## Assistant safeguards

- Questions are limited to 280 characters and responses to 150 tokens.
- Each visitor is limited to five questions per ten minutes with an eight-second cooldown.
- The site has a 60-request daily cap.
- Configure Upstash Redis for those limits to apply across all Vercel Function instances. Without it, the in-memory fallback is only per instance.

# Ziing — Income Dashboard & Coloring-Book Agent Studio

[![Install with Pinokio](https://badges.pinokio.co/install.svg)](https://pinokio.co/resolve?url=https://github.com/opttyyyyyy/ziing-income-agents)

Ziing is a local web app with two jobs:

1. **One income dashboard.** Track every income stream (Amazon KDP, Etsy, PayPal, Patreon, YouTube, or your own sources) in one place, with monthly charts and per-source breakdowns.
2. **Coloring-book agents.** Create an agent, give it a theme, and let it draw a coloring book page by page using an image API. Review each page, approve the ones you like, and export a print-ready PDF for Amazon KDP.

Everything runs on your own computer. Your income entries, API key, and generated pages stay in `app/data/` and are never uploaded anywhere except to the image API you configure.

## Install and run

Install [Pinokio](https://pinokio.co), then click **Install**. When it finishes, click **Start**. Pinokio will open the app in your browser automatically via the **Open Web UI** tab.

The launcher provides:

- **Install** — installs Node dependencies into `app/node_modules`
- **Start** — launches the server on a free port and shows its URL
- **Update** — refreshes dependencies
- **Reset** — removes installed dependencies so you can reinstall from scratch

Your data is preserved across Update and Reset.

## First-time setup

1. Open **Settings**.
2. Paste an API key from an OpenAI-compatible image API. The defaults are `https://api.openai.com/v1` and model `gpt-image-1`. If you use another provider, change the base URL and model to match.
3. Click **Save settings**.

You need a paid image API key to generate pages. Browsing the dashboard and entering income works without one.

## Using the app

### Income

- Go to **Income** and use **Add income** to record a payment: choose a source, enter an amount, a date, and an optional note.
- Add any extra platform with **Add source**.
- Paste spreadsheet rows into **Import from CSV** to add many entries at once. Columns are `source, amount, date, note`; a header row is optional and quoted values are supported. Example:

  ```csv
  source,amount,date,note
  Amazon KDP,123.45,2026-11-01,November royalties
  Etsy,42.00,2026-11-03,Digital downloads
  ```

- The **Overview** tab shows all-time income, this month, top source, a 12-month chart, and a source breakdown.

### Agents

- Go to **Agents** and create an agent with a theme (for example `cute woodland animals for kids`), an optional style, and a page count.
- Click **Start**. The agent generates pages one at a time. Use **Stop** to pause it. Progress appears on the agent card.
- Open **Page review** to approve or reject each page. Filter by agent if you have several.
- Click **Export PDF** on an agent to download a coloring book containing all of its approved pages, with a title page.

Agents only generate images. Publishing to Amazon KDP is done by you, using the exported PDF.

## API

The server exposes a small JSON API. All state-changing endpoints return the complete updated state object, which contains `sources`, `income`, `agents`, `pages`, and `settings` (the API key is masked).

Base URL: `http://127.0.0.1:<PORT>` — the port is shown in Pinokio's **Open Web UI** tab.

| Method | Endpoint | Body | Purpose |
| --- | --- | --- | --- |
| GET | `/api/state` | — | Read all data |
| POST | `/api/settings` | `{ baseUrl, apiKey, model, size }` | Update API configuration |
| POST | `/api/sources` | `{ name, color }` | Add a source |
| DELETE | `/api/sources/:id` | — | Remove a source and its entries |
| POST | `/api/income` | `{ sourceId, amount, date, note }` | Add an income entry |
| DELETE | `/api/income/:id` | — | Remove an income entry |
| POST | `/api/income/import` | `{ text }` | Import CSV rows |
| POST | `/api/agents` | `{ name, theme, style, pagesTarget }` | Create an agent |
| POST | `/api/agents/:id/start` | — | Start generating |
| POST | `/api/agents/:id/stop` | — | Pause generating |
| DELETE | `/api/agents/:id` | — | Delete an agent and its pages |
| POST | `/api/pages/:id/review` | `{ status: "approved" \| "rejected" \| "pending" }` | Review a page |
| GET | `/api/pages/:id/image` | — | Fetch a generated PNG |
| GET | `/api/export/:agentId` | — | Download the approved pages as a PDF |

### JavaScript

```javascript
const BASE = 'http://127.0.0.1:3000'

async function api(path, method = 'GET', body) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  return response.json()
}

const state = await api('/api/state')
console.log('Total income:', state.income.reduce((sum, item) => sum + item.amount, 0))

await api('/api/income', 'POST', {
  sourceId: state.sources[0].id,
  amount: 25.50,
  date: '2026-11-25',
  note: 'Royalties'
})

await api('/api/agents', 'POST', { theme: 'ocean animals', pagesTarget: 12 })
```

### Python

```python
import requests

BASE = 'http://127.0.0.1:3000'

state = requests.get(f'{BASE}/api/state').json()
source_id = state['sources'][0]['id']

requests.post(f'{BASE}/api/income', json={
    'sourceId': source_id,
    'amount': 25.50,
    'date': '2026-11-25',
    'note': 'Royalties',
})

requests.post(f'{BASE}/api/agents', json={
    'theme': 'ocean animals',
    'pagesTarget': 12,
})
```

### Curl

```bash
curl http://127.0.0.1:3000/api/state

curl -X POST http://127.0.0.1:3000/api/income \
  -H "Content-Type: application/json" \
  -d '{"sourceId":"kdp","amount":25.50,"date":"2026-11-25","note":"Royalties"}'

curl -X POST http://127.0.0.1:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{"theme":"ocean animals","pagesTarget":12}'

curl -O -J http://127.0.0.1:3000/api/export/AGENT_ID
```

## Notes

- Requires Node.js 18 or newer (provided by Pinokio).
- The image API key is stored in `app/data/store.json` on your machine. Do not commit that file.
- If generating pages fails, the agent card shows the exact API error so you can fix the key, model, or base URL and press Start again.

## Add to the Pinokio directory

Open the install link in the badge above (or https://pinokio.co/resolve?url=https://github.com/opttyyyyyy/ziing-income-agents), sign in if prompted, and choose to add the project to the Pinokio directory when asked.

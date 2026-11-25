const express = require('express')
const fs = require('fs')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')
const PDFDocument = require('pdfkit')

const app = express()
const PORT = Number(process.env.PORT) || 3000
const DATA_DIR = path.join(__dirname, 'data')
const PAGES_DIR = path.join(DATA_DIR, 'pages')
const STORE_FILE = path.join(DATA_DIR, 'store.json')

fs.mkdirSync(PAGES_DIR, { recursive: true })

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function defaultStore() {
  return {
    sources: [
      { id: 'kdp', name: 'Amazon KDP', color: '#ff9900' },
      { id: 'etsy', name: 'Etsy', color: '#f26522' },
      { id: 'paypal', name: 'PayPal', color: '#009cde' },
      { id: 'patreon', name: 'Patreon', color: '#ff424d' },
      { id: 'youtube', name: 'YouTube', color: '#ff0033' },
      { id: 'other', name: 'Other', color: '#8b949e' }
    ],
    income: [],
    agents: [],
    pages: [],
    settings: {
      provider: 'cloud',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-image-1',
      size: '1024x1024',
      localModel: 'sd-turbo',
      localSteps: 2
    }
  }
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
    const base = defaultStore()
    return {
      ...base,
      ...parsed,
      sources: Array.isArray(parsed.sources) ? parsed.sources : base.sources,
      income: Array.isArray(parsed.income) ? parsed.income : base.income,
      agents: Array.isArray(parsed.agents) ? parsed.agents : base.agents,
      pages: Array.isArray(parsed.pages) ? parsed.pages : base.pages,
      settings: { ...base.settings, ...(parsed.settings || {}) }
    }
  } catch (error) {
    return defaultStore()
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2))
}

function publicStore(store) {
  return {
    ...store,
    capabilities: { gpu: process.env.GPU || 'unknown' },
    settings: {
      ...store.settings,
      apiKey: store.settings.apiKey ? '********' : ''
    }
  }
}

let workerProcess = null
let workerPort = null

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

async function ensureWorker() {
  if (workerProcess && workerProcess.exitCode === null) return workerPort
  const python = path.join(__dirname, '..', 'env', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
  if (!fs.existsSync(python)) {
    throw new Error('Local generator is not installed. Run Install again on this computer.')
  }
  workerPort = await freePort()
  workerProcess = spawn(python, [path.join(__dirname, 'generate.py')], {
    env: { ...process.env, PORT: String(workerPort) },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  workerProcess.stderr.on('data', (chunk) => process.stderr.write(`[local generator] ${chunk}`))
  workerProcess.on('exit', () => { workerProcess = null })
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${workerPort}/health`)
      if (response.ok) return workerPort
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error('Local generator did not start. Check the Pinokio terminal for details.')
}

async function fetchLocal(settings, prompt) {
  const port = await ensureWorker()
  const response = await fetch(`http://127.0.0.1:${port}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.localModel || 'sd-turbo',
      steps: settings.localSteps || 2,
      prompt
    })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Local generator returned ${response.status}`)
  if (!data.image) throw new Error('Local generator returned no image')
  return Buffer.from(data.image, 'base64')
}

function splitCSV(line) {
  const columns = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      columns.push(current)
      current = ''
    } else {
      current += char
    }
  }
  columns.push(current)
  return columns
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'coloring-book'
}

function buildPrompt(theme, style, index) {
  const extra = style && style.trim() ? ` Art style: ${style.trim()}.` : ''
  return `A print-ready black and white coloring page illustration. Main subject and theme: ${theme}. Page ${index} of a coloring book.${extra} Clean bold outlines on a pure white background, no shading, no gray fills, no color, no text, no border, no watermark. Simple recognizable shapes with large open areas that are easy and fun to color. Centered composition with generous white margins.`
}

async function fetchImage(settings, prompt) {
  if (settings.provider === 'local') return fetchLocal(settings, prompt)
  const endpoint = String(settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/images/generations'
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model || 'gpt-image-1',
      prompt,
      n: 1,
      size: settings.size || '1024x1024'
    })
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error((data.error && (data.error.message || data.error)) || `Image API returned ${response.status}`)
  }
  const item = data.data && data.data[0]
  if (!item) throw new Error('Image API returned no image')
  if (item.b64_json) return Buffer.from(item.b64_json, 'base64')
  if (item.url) {
    const download = await fetch(item.url)
    if (!download.ok) throw new Error('Could not download the generated image')
    return Buffer.from(await download.arrayBuffer())
  }
  throw new Error('Unexpected image API response')
}

const activeAgents = new Set()

async function runAgent(agentId) {
  if (activeAgents.has(agentId)) return
  activeAgents.add(agentId)
  try {
    while (true) {
      let store = loadStore()
      const agent = store.agents.find((item) => item.id === agentId)
      if (!agent || agent.status !== 'running') break
      const generated = store.pages.filter((page) => page.agentId === agentId).length
      if (generated >= agent.pagesTarget) {
        agent.status = 'done'
        agent.error = ''
        saveStore(store)
        break
      }
      try {
        const prompt = buildPrompt(agent.theme, agent.style, generated + 1)
        const buffer = await fetchImage(store.settings, prompt)
        const file = `${agentId}-${uid()}.png`
        fs.writeFileSync(path.join(PAGES_DIR, file), buffer)
        store = loadStore()
        store.pages.push({
          id: uid(),
          agentId,
          index: generated + 1,
          prompt,
          status: 'pending',
          file,
          createdAt: new Date().toISOString()
        })
        saveStore(store)
      } catch (error) {
        store = loadStore()
        const failed = store.agents.find((item) => item.id === agentId)
        if (failed) {
          failed.status = 'error'
          failed.error = error.message || String(error)
        }
        saveStore(store)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  } finally {
    activeAgents.delete(agentId)
  }
}

app.use(express.json({ limit: '30mb' }))
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/state', (req, res) => {
  res.json(publicStore(loadStore()))
})

app.post('/api/settings', (req, res) => {
  const store = loadStore()
  const incoming = req.body || {}
  for (const key of ['provider', 'baseUrl', 'apiKey', 'model', 'size', 'localModel', 'localSteps']) {
    if (incoming[key] === undefined) continue
    if (key === 'apiKey' && incoming[key] === '********') continue
    store.settings[key] = String(incoming[key])
  }
  saveStore(store)
  res.json(publicStore(store))
})

app.post('/api/sources', (req, res) => {
  const store = loadStore()
  const name = String(req.body.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Source name is required' })
  if (!store.sources.some((source) => source.name.toLowerCase() === name.toLowerCase())) {
    store.sources.push({ id: uid(), name, color: String(req.body.color || '#8b949e') })
  }
  saveStore(store)
  res.json(publicStore(store))
})

app.delete('/api/sources/:id', (req, res) => {
  const store = loadStore()
  store.sources = store.sources.filter((source) => source.id !== req.params.id)
  store.income = store.income.filter((entry) => entry.sourceId !== req.params.id)
  saveStore(store)
  res.json(publicStore(store))
})

app.post('/api/income', (req, res) => {
  const store = loadStore()
  const amount = Number(req.body.amount)
  if (!Number.isFinite(amount)) return res.status(400).json({ error: 'Enter a valid amount' })
  const sourceId = String(req.body.sourceId || (store.sources[0] && store.sources[0].id))
  if (!store.sources.some((source) => source.id === sourceId)) {
    return res.status(400).json({ error: 'Choose a source' })
  }
  store.income.push({
    id: uid(),
    sourceId,
    amount,
    date: String(req.body.date || new Date().toISOString().slice(0, 10)),
    note: String(req.body.note || '')
  })
  saveStore(store)
  res.json(publicStore(store))
})

app.delete('/api/income/:id', (req, res) => {
  const store = loadStore()
  store.income = store.income.filter((entry) => entry.id !== req.params.id)
  saveStore(store)
  res.json(publicStore(store))
})

app.post('/api/income/import', (req, res) => {
  const text = String(req.body.text || '')
  const store = loadStore()
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim())
  if (!lines.length) return res.status(400).json({ error: 'Paste some CSV rows first' })
  const header = splitCSV(lines[0]).map((cell) => cell.trim().toLowerCase())
  const hasHeader = header.some((cell) => ['source', 'amount', 'date'].includes(cell))
  const column = (names, fallback) => (hasHeader ? header.findIndex((cell) => names.includes(cell)) : fallback)
  const sourceColumn = column(['source', 'platform', 'account'], 0)
  const amountColumn = column(['amount', 'total', 'value', 'earnings'], 1)
  const dateColumn = column(['date', 'day', 'time'], 2)
  const noteColumn = column(['note', 'description', 'memo'], 3)
  let added = 0
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = splitCSV(line)
    const sourceName = (cells[sourceColumn] || '').trim()
    const amount = Number(String(cells[amountColumn] || '').replace(/[$,]/g, ''))
    if (!sourceName || !Number.isFinite(amount) || amount === 0) continue
    let source = store.sources.find((item) => item.name.toLowerCase() === sourceName.toLowerCase())
    if (!source) {
      source = { id: uid(), name: sourceName, color: '#8b949e' }
      store.sources.push(source)
    }
    const rawDate = (cells[dateColumn] || '').trim()
    let date = rawDate || new Date().toISOString().slice(0, 10)
    if (rawDate) {
      const parsed = new Date(rawDate)
      if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString().slice(0, 10)
    }
    const note = noteColumn >= 0 ? (cells[noteColumn] || '').trim() : ''
    store.income.push({ id: uid(), sourceId: source.id, amount, date, note })
    added++
  }
  saveStore(store)
  res.json({ added, state: publicStore(store) })
})

app.post('/api/agents', (req, res) => {
  const store = loadStore()
  const theme = String(req.body.theme || '').trim()
  if (!theme) return res.status(400).json({ error: 'Give the agent a theme' })
  const pagesTarget = Math.max(1, Math.min(100, Number(req.body.pagesTarget) || 12))
  store.agents.push({
    id: uid(),
    name: String(req.body.name || theme).trim(),
    theme,
    style: String(req.body.style || '').trim(),
    pagesTarget,
    status: 'idle',
    error: '',
    createdAt: new Date().toISOString()
  })
  saveStore(store)
  res.json(publicStore(store))
})

app.post('/api/agents/:id/start', (req, res) => {
  const store = loadStore()
  const agent = store.agents.find((item) => item.id === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  if (store.settings.provider !== 'local' && !store.settings.apiKey) {
    return res.status(400).json({ error: 'Add your API key in Settings first, or switch to Local generation' })
  }
  agent.status = 'running'
  agent.error = ''
  saveStore(store)
  res.json(publicStore(store))
  runAgent(agent.id)
})

app.post('/api/agents/:id/stop', (req, res) => {
  const store = loadStore()
  const agent = store.agents.find((item) => item.id === req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  agent.status = 'stopped'
  saveStore(store)
  res.json(publicStore(store))
})

app.delete('/api/agents/:id', (req, res) => {
  const store = loadStore()
  const agent = store.agents.find((item) => item.id === req.params.id)
  if (agent) agent.status = 'stopped'
  for (const page of store.pages.filter((item) => item.agentId === req.params.id)) {
    const file = path.join(PAGES_DIR, page.file)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  }
  store.agents = store.agents.filter((item) => item.id !== req.params.id)
  store.pages = store.pages.filter((item) => item.agentId !== req.params.id)
  saveStore(store)
  res.json(publicStore(store))
})

app.post('/api/pages/:id/review', (req, res) => {
  const store = loadStore()
  const page = store.pages.find((item) => item.id === req.params.id)
  if (!page) return res.status(404).json({ error: 'Page not found' })
  if (req.body.status === 'approved') page.status = 'approved'
  else if (req.body.status === 'rejected') page.status = 'rejected'
  else page.status = 'pending'
  saveStore(store)
  res.json(publicStore(store))
})

app.get('/api/pages/:id/image', (req, res) => {
  const store = loadStore()
  const page = store.pages.find((item) => item.id === req.params.id)
  if (!page) return res.status(404).send('Not found')
  const file = path.join(PAGES_DIR, page.file)
  if (!fs.existsSync(file)) return res.status(404).send('Not found')
  res.sendFile(file)
})

app.get('/api/export/:agentId', (req, res) => {
  const store = loadStore()
  const agent = store.agents.find((item) => item.id === req.params.agentId)
  if (!agent) return res.status(404).send('Agent not found')
  const pages = store.pages.filter((item) => item.agentId === agent.id && item.status === 'approved')
  if (!pages.length) return res.status(400).send('Approve at least one page before exporting')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(agent.theme)}-coloring-book.pdf"`)
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false })
  doc.pipe(res)
  doc.addPage()
  doc.fontSize(40).fillColor('#111111').text(agent.theme, 72, 280, { align: 'center', width: 468 })
  doc.fontSize(18).fillColor('#666666').text('Coloring Book', 72, 350, { align: 'center', width: 468 })
  doc.fontSize(12).fillColor('#999999').text(`Created with Ziing`, 72, 700, { align: 'center', width: 468 })
  for (const page of pages) {
    const file = path.join(PAGES_DIR, page.file)
    if (!fs.existsSync(file)) continue
    doc.addPage()
    doc.image(file, 36, 36, { fit: [540, 720], align: 'center', valign: 'center' })
  }
  doc.end()
})

app.use((error, req, res, next) => {
  res.status(400).json({ error: error.message || 'Bad request' })
})

process.on('exit', () => {
  if (workerProcess && workerProcess.exitCode === null) workerProcess.kill()
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Ziing is ready at http://127.0.0.1:${PORT}`)
})

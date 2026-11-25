let state = { sources: [], income: [], agents: [], pages: [], settings: {} }
let currentView = 'overview'
let pageFilter = 'all'
let toastTimer = null

const viewMeta = {
  overview: ['Overview', 'Your income and coloring-book agents at a glance.'],
  income: ['Income', 'Track every income stream in one place.'],
  agents: ['Agents', 'Create, run, and review your coloring-book agents.'],
  settings: ['Settings', 'Connect your image API and set your preferences.']
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(Number(value) || 0)
}

function notify(message, type) {
  const el = document.getElementById('toast')
  el.textContent = message
  el.className = 'toast ' + (type || '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000)
}

async function api(path, options) {
  const response = await fetch(path, options)
  let data = {}
  try {
    data = await response.json()
  } catch (error) {
    data = {}
  }
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

async function post(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
}

async function commit(path, body, message, imported) {
  const data = await post(path, body)
  if (imported) {
    state = data.state
    notify(`${data.added} row${data.added === 1 ? '' : 's'} imported`, 'success')
  } else {
    state = data
    if (message) notify(message, 'success')
  }
  render()
}

async function load(silent) {
  try {
    state = await api('/api/state')
    render()
    document.getElementById('sync-label').textContent = 'Connected'
  } catch (error) {
    document.getElementById('sync-label').textContent = 'Offline'
    if (!silent) notify(error.message, 'error')
  }
}

function captureForm(id) {
  const form = document.getElementById(id)
  if (!form) return null
  const values = {}
  for (const el of form.querySelectorAll('[name]')) values[el.name] = el.value
  return values
}

function restoreForm(id, values) {
  if (!values) return
  const form = document.getElementById(id)
  if (!form) return
  for (const el of form.querySelectorAll('[name]')) {
    if (values[el.name] !== undefined) el.value = values[el.name]
  }
}

function sourceName(id) {
  const source = (state.sources || []).find((item) => item.id === id)
  return source ? source.name : 'Unknown'
}

function sourceColor(id) {
  const source = (state.sources || []).find((item) => item.id === id)
  return source ? source.color : '#8b949e'
}

function sourceOptions(selected) {
  return (state.sources || []).map((source) => {
    const chosen = source.id === selected ? ' selected' : ''
    return `<option value="${esc(source.id)}"${chosen}>${esc(source.name)}</option>`
  }).join('')
}

function render() {
  renderOverview()
  renderIncome()
  renderAgents()
  renderSettings()
}

function renderOverview() {
  const el = document.getElementById('view-overview')
  const income = state.income || []
  const sources = state.sources || []
  const agents = state.agents || []
  const pages = state.pages || []
  const total = income.reduce((sum, item) => sum + item.amount, 0)
  const monthKey = new Date().toISOString().slice(0, 7)
  const monthTotal = income.filter((item) => String(item.date).startsWith(monthKey)).reduce((sum, item) => sum + item.amount, 0)
  const running = agents.filter((agent) => agent.status === 'running').length
  const pending = pages.filter((page) => page.status === 'pending').length
  const breakdown = sources.map((source) => ({
    ...source,
    total: income.filter((item) => item.sourceId === source.id).reduce((sum, item) => sum + item.amount, 0)
  })).sort((a, b) => b.total - a.total)
  const top = breakdown[0] || { name: '—', total: 0 }

  const now = new Date()
  const months = []
  for (let i = 11; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = date.toISOString().slice(0, 7)
    months.push({
      label: date.toLocaleString('en-US', { month: 'short' }),
      total: income.filter((item) => String(item.date).startsWith(key)).reduce((sum, item) => sum + item.amount, 0)
    })
  }
  const max = Math.max(1, ...months.map((item) => item.total))
  const chart = months.map((item) => `
    <div class="chart-col">
      <div class="chart-value">${item.total ? esc(money(item.total)) : ''}</div>
      <div class="chart-bar" style="height:${Math.max(3, Math.round((item.total / max) * 118))}px"></div>
      <div class="chart-label">${esc(item.label)}</div>
    </div>`).join('')

  const bars = breakdown.filter((item) => item.total > 0).map((item) => `
    <div class="breakdown-row">
      <div class="breakdown-head"><span>${esc(item.name)}</span><span>${esc(money(item.total))}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (item.total / Math.max(1, total)) * 100)}%;background:${esc(item.color)}"></div></div>
    </div>`).join('') || '<p class="empty">No income recorded yet.</p>'

  const recent = [...income].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6)
  const recentRows = recent.map((item) => `
    <tr>
      <td><span class="tag"><span class="tag-dot" style="background:${esc(sourceColor(item.sourceId))}"></span>${esc(sourceName(item.sourceId))}</span></td>
      <td>${esc(item.date)}</td>
      <td class="muted">${esc(item.note || '—')}</td>
      <td class="amount positive">${esc(money(item.amount))}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">Add your first income entry to get started.</td></tr>'

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">All-time income</div><div class="stat-value">${esc(money(total))}</div><div class="stat-hint">Across ${sources.length} sources</div></div>
      <div class="stat-card"><div class="stat-label">This month</div><div class="stat-value">${esc(money(monthTotal))}</div><div class="stat-hint">${esc(monthKey)}</div></div>
      <div class="stat-card"><div class="stat-label">Top source</div><div class="stat-value">${esc(top.name)}</div><div class="stat-hint">${esc(money(top.total))}</div></div>
      <div class="stat-card"><div class="stat-label">Agents running</div><div class="stat-value">${running}</div><div class="stat-hint">${pending} page${pending === 1 ? '' : 's'} awaiting review</div></div>
    </div>
    <div class="panel-grid">
      <div class="panel">
        <h2>Income over the last 12 months</h2>
        <p class="hint">Totals grouped by the month each entry was earned.</p>
        <div class="chart">${chart}</div>
      </div>
      <div class="panel">
        <h2>Income by source</h2>
        <p class="hint">Where your money is coming from.</p>
        ${bars}
      </div>
    </div>
    <div class="panel">
      <h2>Recent income</h2>
      <p class="hint">The latest entries across all of your sources.</p>
      <table>
        <thead><tr><th>Source</th><th>Date</th><th>Note</th><th>Amount</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table>
    </div>`
}

function renderIncome() {
  const el = document.getElementById('view-income')
  const income = state.income || []
  const sources = state.sources || []
  const capturedIncome = captureForm('income-form')
  const capturedSource = captureForm('source-form')
  const capturedImport = captureForm('import-form')

  const chips = sources.map((source) => `
    <span class="source-chip">
      <span class="tag-dot" style="background:${esc(source.color)}"></span>${esc(source.name)}
      <button data-action="delete-source" data-id="${esc(source.id)}" title="Remove source">×</button>
    </span>`).join('') || '<span class="muted">No custom sources yet.</span>'

  const rows = [...income].reverse().slice(0, 100).map((item) => `
    <tr>
      <td><span class="tag"><span class="tag-dot" style="background:${esc(sourceColor(item.sourceId))}"></span>${esc(sourceName(item.sourceId))}</span></td>
      <td>${esc(item.date)}</td>
      <td class="muted">${esc(item.note || '—')}</td>
      <td class="amount positive">${esc(money(item.amount))}</td>
      <td><button class="btn small danger" data-action="delete-income" data-id="${esc(item.id)}">Delete</button></td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">No income entries yet.</td></tr>'

  el.innerHTML = `
    <div class="panel-grid two">
      <div class="panel">
        <h2>Add income</h2>
        <p class="hint">Record a payment from any source.</p>
        <form id="income-form">
          <div class="field"><label for="income-source">Source</label><select id="income-source" name="sourceId">${sourceOptions(sources[0] && sources[0].id)}</select></div>
          <div class="field"><label for="income-amount">Amount</label><input id="income-amount" name="amount" type="number" step="0.01" min="0" placeholder="0.00" required></div>
          <div class="field"><label for="income-date">Date</label><input id="income-date" name="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="field grow"><label for="income-note">Note</label><input id="income-note" name="note" placeholder="Optional note"></div>
          <button class="btn primary" type="submit">Add entry</button>
        </form>
      </div>
      <div class="panel">
        <h2>Income sources</h2>
        <p class="hint">Add a platform that is not listed yet.</p>
        <form id="source-form">
          <div class="field grow"><label for="source-name">Source name</label><input id="source-name" name="name" placeholder="e.g. Gumroad" required></div>
          <div class="field"><label for="source-color">Color</label><input id="source-color" name="color" type="color" value="#6c5ce7"></div>
          <button class="btn" type="submit">Add source</button>
        </form>
        <div class="source-list">${chips}</div>
      </div>
    </div>
    <div class="panel">
      <h2>Import from CSV</h2>
      <p class="hint">Paste rows with columns: source, amount, date, note. A header row is optional. Quoted values are supported.</p>
      <form id="import-form">
        <div class="field grow"><label for="import-text">CSV data</label><textarea id="import-text" name="text" placeholder="source,amount,date,note&#10;Amazon KDP,123.45,2026-11-01,November royalties"></textarea></div>
        <button class="btn primary" type="submit">Import rows</button>
      </form>
    </div>
    <div class="panel">
      <h2>All entries</h2>
      <p class="hint">Showing the most recent 100 entries. Total: ${esc(money(income.reduce((sum, item) => sum + item.amount, 0)))}.</p>
      <table>
        <thead><tr><th>Source</th><th>Date</th><th>Note</th><th>Amount</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`

  restoreForm('income-form', capturedIncome)
  restoreForm('source-form', capturedSource)
  restoreForm('import-form', capturedImport)
}

function renderAgents() {
  const el = document.getElementById('view-agents')
  const agents = state.agents || []
  const pages = state.pages || []
  const captured = captureForm('agent-form')

  if (pageFilter !== 'all' && !agents.some((agent) => agent.id === pageFilter)) pageFilter = 'all'
  const visiblePages = pageFilter === 'all' ? pages : pages.filter((page) => page.agentId === pageFilter)

  const cards = agents.map((agent) => {
    const made = pages.filter((page) => page.agentId === agent.id).length
    const approved = pages.filter((page) => page.agentId === agent.id && page.status === 'approved').length
    const running = agent.status === 'running'
    return `
      <div class="agent">
        <div class="agent-head">
          <div>
            <div class="agent-title">${esc(agent.name)} <span class="status ${esc(agent.status)}">${esc(agent.status)}</span></div>
            <div class="agent-meta">Theme: ${esc(agent.theme)}${agent.style ? ` · Style: ${esc(agent.style)}` : ''}</div>
          </div>
          <div class="agent-actions">
            ${running
              ? `<button class="btn danger" data-action="agent-stop" data-id="${esc(agent.id)}">Stop</button>`
              : `<button class="btn primary" data-action="agent-start" data-id="${esc(agent.id)}">Start</button>`}
            <button class="btn green" data-action="agent-export" data-id="${esc(agent.id)}" ${approved ? '' : 'disabled'}>Export PDF (${approved})</button>
            <button class="btn danger" data-action="agent-delete" data-id="${esc(agent.id)}">Delete</button>
          </div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, (made / agent.pagesTarget) * 100)}%"></div></div>
        <div class="agent-meta">${made} of ${agent.pagesTarget} pages generated · ${approved} approved · ${pages.filter((page) => page.agentId === agent.id && page.status === 'pending').length} awaiting review</div>
        ${agent.error ? `<div class="agent-error">${esc(agent.error)}</div>` : ''}
      </div>`
  }).join('') || '<div class="panel"><p class="empty">No agents yet. Create one above to start a coloring book.</p></div>'

  const filterOptions = agents.map((agent) => `<option value="${esc(agent.id)}"${agent.id === pageFilter ? ' selected' : ''}>${esc(agent.name)}</option>`).join('')
  const gallery = visiblePages.slice().reverse().map((page) => `
    <div class="page-card">
      <img src="/api/pages/${esc(page.id)}/image" alt="Generated coloring page ${esc(page.index)}">
      <div class="page-card-body">
        <div class="page-card-title">Page ${esc(page.index)} · <span class="status ${esc(page.status)}">${esc(page.status)}</span></div>
        <div class="page-actions">
          <button class="btn small green" data-action="page-approve" data-id="${esc(page.id)}">Approve</button>
          <button class="btn small danger" data-action="page-reject" data-id="${esc(page.id)}">Reject</button>
        </div>
      </div>
    </div>`).join('') || '<p class="empty">No pages generated yet.</p>'

  el.innerHTML = `
    <div class="panel">
      <h2>New coloring-book agent</h2>
      <p class="hint">Give it a theme and a page count. You can start and stop it whenever you like.</p>
      <form id="agent-form">
        <div class="field"><label for="agent-name">Agent name</label><input id="agent-name" name="name" placeholder="e.g. Forest animals"></div>
        <div class="field grow"><label for="agent-theme">Theme</label><input id="agent-theme" name="theme" placeholder="e.g. cute woodland animals for kids" required></div>
        <div class="field"><label for="agent-style">Style (optional)</label><input id="agent-style" name="style" placeholder="e.g. bold simple outlines"></div>
        <div class="field"><label for="agent-pages">Pages</label><input id="agent-pages" name="pagesTarget" type="number" min="1" max="100" value="12"></div>
        <button class="btn primary" type="submit">Create agent</button>
      </form>
    </div>
    <h2 style="margin:24px 0 12px;font-size:15px;">Your agents</h2>
    ${cards}
    <div class="panel">
      <h2>Page review</h2>
      <p class="hint">Approve the pages you want in your book, then export it as a print-ready PDF.</p>
      <div class="filter-row">
        <label class="muted" for="page-filter">Show pages from</label>
        <select id="page-filter"><option value="all"${pageFilter === 'all' ? ' selected' : ''}>All agents</option>${filterOptions}</select>
      </div>
      <div class="gallery">${gallery}</div>
    </div>`

  restoreForm('agent-form', captured)
}

function renderSettings() {
  const el = document.getElementById('view-settings')
  const settings = state.settings || {}
  const gpu = (state.capabilities && state.capabilities.gpu) || 'unknown'
  const canLocal = gpu === 'nvidia'
  const provider = settings.provider || 'cloud'
  const captured = captureForm('settings-form')
  el.innerHTML = `
    <div class="panel">
      <h2>Image generation</h2>
      <p class="hint">Use a cloud API or generate pages on your own NVIDIA GPU. Local mode needs a one-time model install via the Install button.</p>
      <form id="settings-form">
        <div class="field grow"><label for="settings-provider">Provider</label><select id="settings-provider" name="provider">
          <option value="cloud"${provider === 'cloud' ? ' selected' : ''}>Cloud API (OpenAI-compatible)</option>
          <option value="local"${provider === 'local' ? ' selected' : ''}${canLocal ? '' : ' disabled'}>Local GPU${canLocal ? '' : ' (NVIDIA required)'}</option>
        </select></div>
        <div id="cloud-fields" class="${provider === 'local' ? 'hidden' : ''}" style="display:contents">
          <div class="field grow"><label for="settings-base">API base URL</label><input id="settings-base" name="baseUrl" value="${esc(settings.baseUrl || '')}" placeholder="https://api.openai.com/v1"></div>
          <div class="field"><label for="settings-model">Model</label><input id="settings-model" name="model" value="${esc(settings.model || '')}" placeholder="gpt-image-1"></div>
          <div class="field"><label for="settings-size">Image size</label><select id="settings-size" name="size">
            ${['1024x1024', '1536x1024', '1024x1536', '512x512'].map((size) => `<option value="${size}"${settings.size === size ? ' selected' : ''}>${size}</option>`).join('')}
          </select></div>
          <div class="field grow"><label for="settings-key">API key</label><input id="settings-key" name="apiKey" type="password" value="${esc(settings.apiKey || '')}" placeholder="sk-..."></div>
        </div>
        <div id="local-fields" class="${provider === 'local' ? '' : 'hidden'}" style="display:contents">
          <div class="field grow"><label for="settings-local-model">Local model</label><select id="settings-local-model" name="localModel">
            <option value="sd-turbo"${(settings.localModel || 'sd-turbo') === 'sd-turbo' ? ' selected' : ''}>SD Turbo (installed by default)</option>
            <option value="sdxl-turbo"${settings.localModel === 'sdxl-turbo' ? ' selected' : ''}>SDXL Turbo (downloads on first use)</option>
          </select></div>
          <div class="field"><label for="settings-steps">Steps</label><input id="settings-steps" name="localSteps" type="number" min="1" max="8" value="${settings.localSteps || 2}"></div>
        </div>
        <button class="btn primary" type="submit">Save settings</button>
      </form>
      ${canLocal ? '' : '<p class="hint" style="margin-top:12px">Local generation is disabled because this computer has no NVIDIA GPU detected by Pinokio.</p>'}
    </div>
    <div class="panel">
      <h2>How it works</h2>
      <div class="note-box">
        <p><strong>1. Add income.</strong> Enter payments by hand or paste CSV rows from any platform. Everything is stored locally in <code>app/data/store.json</code>.</p>
        <p><strong>2. Create an agent.</strong> Give it a theme such as "ocean animals" and choose how many pages it should make.</p>
        <p><strong>3. Start it.</strong> With Local selected, the first page loads the model into GPU memory (this takes a minute); later pages are fast. Use Stop to pause.</p>
        <p><strong>4. Review and export.</strong> Approve the pages you like, then download a print-ready coloring book PDF for Amazon KDP.</p>
      </div>
    </div>`
  restoreForm('settings-form', captured)
}

function switchView(view) {
  currentView = view
  for (const item of document.querySelectorAll('.nav-item')) item.classList.toggle('active', item.dataset.view === view)
  for (const key of Object.keys(viewMeta)) document.getElementById('view-' + key).classList.toggle('hidden', key !== view)
  document.getElementById('view-title').textContent = viewMeta[view][0]
  document.getElementById('view-subtitle').textContent = viewMeta[view][1]
}

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-view]')
  if (nav) {
    switchView(nav.dataset.view)
    return
  }
  const button = event.target.closest('[data-action]')
  if (!button) return
  const action = button.dataset.action
  const id = button.dataset.id
  try {
    if (action === 'delete-income') {
      state = await api('/api/income/' + id, { method: 'DELETE' })
      render()
      notify('Entry removed')
    } else if (action === 'delete-source') {
      state = await api('/api/sources/' + id, { method: 'DELETE' })
      render()
      notify('Source removed')
    } else if (action === 'agent-start') {
      await commit('/api/agents/' + id + '/start', {}, 'Agent started')
    } else if (action === 'agent-stop') {
      await commit('/api/agents/' + id + '/stop', {}, 'Agent paused')
    } else if (action === 'agent-delete') {
      state = await api('/api/agents/' + id, { method: 'DELETE' })
      render()
      notify('Agent deleted')
    } else if (action === 'agent-export') {
      window.location.href = '/api/export/' + id
    } else if (action === 'page-approve') {
      await commit('/api/pages/' + id + '/review', { status: 'approved' }, 'Page approved')
    } else if (action === 'page-reject') {
      await commit('/api/pages/' + id + '/review', { status: 'rejected' }, 'Page rejected')
    }
  } catch (error) {
    notify(error.message, 'error')
  }
})

document.addEventListener('change', (event) => {
  if (event.target.id === 'page-filter') {
    pageFilter = event.target.value
    renderAgents()
  }
  if (event.target.id === 'settings-provider') {
    const local = event.target.value === 'local'
    document.getElementById('cloud-fields').classList.toggle('hidden', local)
    document.getElementById('local-fields').classList.toggle('hidden', !local)
  }
})

document.addEventListener('submit', async (event) => {
  const form = event.target
  if (!form.id) return
  event.preventDefault()
  const data = new FormData(form)
  const value = (key) => String(data.get(key) || '')
  try {
    if (form.id === 'income-form') {
      await commit('/api/income', { sourceId: value('sourceId'), amount: value('amount'), date: value('date'), note: value('note') }, 'Income added')
      form.reset()
      document.getElementById('income-date').value = new Date().toISOString().slice(0, 10)
    } else if (form.id === 'source-form') {
      await commit('/api/sources', { name: value('name'), color: value('color') }, 'Source added')
      form.reset()
    } else if (form.id === 'import-form') {
      await commit('/api/income/import', { text: value('text') }, '', true)
      form.reset()
    } else if (form.id === 'agent-form') {
      await commit('/api/agents', { name: value('name'), theme: value('theme'), style: value('style'), pagesTarget: value('pagesTarget') }, 'Agent created')
      form.reset()
      document.getElementById('agent-pages').value = 12
    } else if (form.id === 'settings-form') {
      await commit('/api/settings', { provider: value('provider'), baseUrl: value('baseUrl'), apiKey: value('apiKey'), model: value('model'), size: value('size'), localModel: value('localModel'), localSteps: value('localSteps') }, 'Settings saved')
    }
  } catch (error) {
    notify(error.message, 'error')
  }
})

setInterval(async () => {
  const hasRunning = (state.agents || []).some((agent) => agent.status === 'running')
  if (!hasRunning) return
  try {
    state = await api('/api/state')
    renderOverview()
    renderAgents()
  } catch (error) {
    document.getElementById('sync-label').textContent = 'Offline'
  }
}, 1500)

load(true)

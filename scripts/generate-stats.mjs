// Membuat kartu statistik profil (kontribusi setahun & bahasa) sebagai SVG di assets/stats.
// Dijalankan harian oleh .github/workflows/stats.yml, bisa juga manual: node scripts/generate-stats.mjs
// Tanpa dependensi: kalender kontribusi diambil dari halaman publik GitHub, bahasa dari REST API.
import { mkdir, writeFile } from 'node:fs/promises'

const USER = process.env.GH_USER || 'regialhabib'
const TOKEN = process.env.GITHUB_TOKEN
const OUT = new URL('../assets/stats/', import.meta.url)

// Bahasa "sampingan" yang tidak mewakili kode yang ditulis
const IGNORED_LANGS = new Set(['TeX', 'Handlebars', 'Makefile', 'Shell', 'Batchfile', 'Dockerfile', 'Procfile'])
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

// Warna sama dengan portofolio (gaya Playful)
const THEMES = {
  light: { surface: '#FFFFFF', fg: '#1A1530', muted: '#5F5878', ink: '#1A1530', shadow: '#1A1530', track: '#F6F5FB' },
  dark: { surface: '#1D1A2E', fg: '#F3F1FF', muted: '#A9A2C6', ink: '#4A4470', shadow: '#05040A', track: '#131120' },
}
const TONES = {
  light: { yellow: '#FFC83D', mint: '#2ACF9C', pink: '#FF5C8A', blue: '#4D6BFE', onColor: '#1A1530' },
  dark: { yellow: '#FFD05A', mint: '#3EDCAA', pink: '#FF6F98', blue: '#7189FF', onColor: '#1A1530' },
}
const FONT = `'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif`

async function get(url, json = true) {
  const headers = { 'User-Agent': `${USER}-profile-stats` }
  if (TOKEN && url.startsWith('https://api.github.com')) headers.Authorization = `Bearer ${TOKEN}`
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return json ? res.json() : res.text()
}

async function contributions() {
  const html = await get(`https://github.com/users/${USER}/contributions`, false)
  const dates = new Map([...html.matchAll(/data-date="([\d-]+)"[^>]*id="([^"]+)"/g)].map((m) => [m[2], m[1]]))
  const days = [...html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)]
    .filter((m) => dates.has(m[1]))
    .map((m) => ({ date: dates.get(m[1]), count: Number(m[2].match(/^(\d+) contribution/)?.[1] ?? 0) }))
    .sort((a, b) => a.date.localeCompare(b.date))
  // Gagal parsing berarti struktur halaman berubah: hentikan supaya kartu lama tidak tertimpa data kosong
  if (days.length < 300) throw new Error(`Kalender kontribusi tidak terbaca (${days.length} hari)`)
  return days
}

async function languages() {
  const repos = (await get(`https://api.github.com/users/${USER}/repos?per_page=100&type=owner`)).filter(
    (r) => !r.fork && !r.archived && r.name !== USER,
  )
  // Rata-rata porsi per repo, supaya repo yang menyertakan library JS/CSS besar tidak mendominasi
  const share = {}
  let counted = 0
  for (const repo of repos) {
    const langs = Object.entries(await get(repo.languages_url)).filter(([name]) => !IGNORED_LANGS.has(name))
    const total = langs.reduce((sum, [, bytes]) => sum + bytes, 0)
    if (!total) continue
    counted++
    for (const [name, bytes] of langs) share[name] = (share[name] || 0) + bytes / total
  }
  const sorted = Object.entries(share)
    .map(([name, value]) => ({ name, value: value / counted }))
    .sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, 5)
  const rest = sorted.slice(5).reduce((sum, l) => sum + l.value, 0)
  if (rest > 0.005) top.push({ name: 'Lainnya', value: rest })
  return { list: roundPercents(top), repos: counted }
}

// Bulatkan ke persen utuh dengan total tetap 100
function roundPercents(list) {
  const items = list.map((l) => ({ ...l, pct: Math.floor(l.value * 100), rem: (l.value * 100) % 1 }))
  let left = 100 - items.reduce((sum, l) => sum + l.pct, 0)
  for (const l of [...items].sort((a, b) => b.rem - a.rem)) if (left-- > 0) l.pct++
  return items.map(({ name, value, pct }) => ({ name, value, pct }))
}

function summarize(days) {
  let longest = 0
  let run = 0
  for (const d of days) {
    run = d.count ? run + 1 : 0
    longest = Math.max(longest, run)
  }
  const months = []
  for (const d of days) {
    const key = d.date.slice(0, 7)
    if (months.at(-1)?.key !== key) months.push({ key, label: MONTHS[Number(key.slice(5)) - 1], count: 0 })
    months.at(-1).count += d.count
  }
  return {
    total: days.reduce((sum, d) => sum + d.count, 0),
    active: days.filter((d) => d.count).length,
    longest,
    best: days.reduce((max, d) => (d.count > max.count ? d : max), days[0]),
    months,
    from: days[0].date,
    to: days.at(-1).date,
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const fmtDate = (iso) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`

// Bingkai kartu: garis tebal + bayangan solid seperti kartu di portofolio
function frame(w, h, t, title, subtitle, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
  <style>text { font-family: ${FONT}; }</style>
  <rect x="9" y="9" width="${w - 13}" height="${h - 13}" rx="20" fill="${t.shadow}"/>
  <rect x="2" y="2" width="${w - 13}" height="${h - 13}" rx="20" fill="${t.surface}" stroke="${t.ink}" stroke-width="2.5"/>
  <text x="30" y="48" font-size="21" font-weight="800" fill="${t.fg}">${esc(title)}</text>
  <text x="30" y="72" font-size="13" fill="${t.muted}">${esc(subtitle)}</text>
${body}
</svg>
`
}

function contributionCard(s, mode) {
  const t = THEMES[mode]
  const c = TONES[mode]
  const tiles = [
    { value: s.total, label: 'kontribusi', fill: c.yellow, text: c.onColor },
    { value: s.active, label: 'hari aktif', fill: c.mint, text: c.onColor },
    { value: `${s.longest} hari`, label: 'streak terpanjang', fill: c.pink, text: c.onColor },
    { value: s.best.count, label: `rekor sehari · ${fmtDate(s.best.date).slice(0, -5)}`, fill: c.blue, text: '#FFFFFF' },
  ]
  const tileW = 158
  const tileH = 96
  const gap = 14
  const tileSvg = tiles
    .map((tile, i) => {
      const x = 30 + (i % 2) * (tileW + gap)
      const y = 98 + Math.floor(i / 2) * (tileH + gap)
      const tilt = i % 2 ? 1.5 : -1.5
      return `  <g transform="rotate(${tilt} ${x + tileW / 2} ${y + tileH / 2})">
    <rect x="${x + 4}" y="${y + 4}" width="${tileW}" height="${tileH}" rx="14" fill="${t.shadow}"/>
    <rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="14" fill="${tile.fill}" stroke="${t.ink}" stroke-width="2.5"/>
    <text x="${x + 16}" y="${y + 50}" font-size="32" font-weight="800" fill="${tile.text}">${esc(tile.value)}</text>
    <text x="${x + 16}" y="${y + 77}" font-size="12.5" font-weight="700" fill="${tile.text}">${esc(tile.label)}</text>
  </g>`
    })
    .join('\n')

  // Grafik batang per bulan
  const chartX = 392
  const chartW = 806 - chartX
  const base = 282
  const maxH = 140
  const slot = chartW / s.months.length
  const barW = Math.min(22, slot - 10)
  const max = Math.max(...s.months.map((m) => m.count), 1)
  const cycle = [c.yellow, c.mint, c.pink, c.blue]
  const bars = s.months
    .map((m, i) => {
      const h = Math.max(4, Math.round((m.count / max) * maxH))
      const x = chartX + i * slot + (slot - barW) / 2
      const cx = x + barW / 2
      const value = m.count ? `<text x="${cx}" y="${base - h - 8}" font-size="11.5" font-weight="700" fill="${t.fg}" text-anchor="middle">${m.count}</text>` : ''
      return `    <rect x="${x}" y="${base - h}" width="${barW}" height="${h}" rx="5" fill="${m.count ? cycle[i % 4] : t.track}" stroke="${t.ink}" stroke-width="2"/>
    ${value}
    <text x="${cx}" y="${base + 20}" font-size="11.5" fill="${t.muted}" text-anchor="middle">${m.label}</text>`
    })
    .join('\n')

  const body = `${tileSvg}
  <text x="${chartX}" y="108" font-size="13" font-weight="700" fill="${t.muted}">per bulan</text>
  <line x1="${chartX}" y1="${base}" x2="${chartX + chartW}" y2="${base}" stroke="${t.ink}" stroke-width="2" stroke-linecap="round"/>
${bars}`
  return frame(840, 340, t, 'Kontribusi setahun terakhir', `${fmtDate(s.from)} – ${fmtDate(s.to)} · diperbarui otomatis setiap hari`, body)
}

function languageCard(langs, mode) {
  const t = THEMES[mode]
  const c = TONES[mode]
  const colors = [c.blue, c.pink, c.yellow, c.mint, '#B79CFF', t.muted]
  const x0 = 30
  const w = 840 - 13 - x0 - 28
  const y = 96
  const h = 30
  let x = x0
  const segs = langs.list
    .map((l, i) => {
      const segW = (l.value * w).toFixed(2)
      const rect = `    <rect x="${x.toFixed(2)}" y="${y}" width="${segW}" height="${h}" fill="${l.name === 'Lainnya' ? t.muted : colors[i]}"/>`
      const line = i ? `    <line x1="${x.toFixed(2)}" y1="${y}" x2="${x.toFixed(2)}" y2="${y + h}" stroke="${t.ink}" stroke-width="2"/>` : ''
      x += Number(segW)
      return rect + '\n' + line
    })
    .join('\n')
  const col = w / langs.list.length
  const legend = langs.list
    .map((l, i) => {
      const lx = x0 + i * col
      return `  <circle cx="${lx + 8}" cy="${157}" r="7" fill="${l.name === 'Lainnya' ? t.muted : colors[i]}" stroke="${t.ink}" stroke-width="2"/>
  <text x="${lx + 22}" y="${162}" font-size="14.5" font-weight="700" fill="${t.fg}">${esc(l.name)}</text>
  <text x="${lx + 22}" y="${181}" font-size="13" fill="${t.muted}">${l.pct}%</text>`
    })
    .join('\n')
  const body = `  <clipPath id="bar"><rect x="${x0}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/></clipPath>
  <g clip-path="url(#bar)">
${segs}
  </g>
  <rect x="${x0}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="none" stroke="${t.ink}" stroke-width="2.5"/>
${legend}`
  return frame(840, 216, t, 'Bahasa yang paling sering saya pakai', `rata-rata dari ${langs.repos} repo publik, setiap repo berbobot sama`, body)
}

const [days, langs] = await Promise.all([contributions(), languages()])
const stats = summarize(days)
await mkdir(OUT, { recursive: true })
for (const mode of ['light', 'dark']) {
  await writeFile(new URL(`kontribusi-${mode}.svg`, OUT), contributionCard(stats, mode))
  await writeFile(new URL(`bahasa-${mode}.svg`, OUT), languageCard(langs, mode))
}
console.log(`${stats.total} kontribusi, ${stats.active} hari aktif, streak ${stats.longest}`)
console.log(langs.list.map((l) => `${l.name} ${l.pct}%`).join(', '))

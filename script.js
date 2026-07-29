const SPECIAL_CHARS = ["!", "?", "#", "%", "*", "+", "@"]
const GAUGE_ARC_LENGTH = 157 // longueur du demi-cercle SVG (π × rayon 50)
const FUN_FACT_INTERVAL_MS = 10000
const HISTORY_STORAGE_KEY = "pass-history"
const MAX_HISTORY = 10
// Les changements d'options régénèrent la phrase à chaque frappe/glissement
// de curseur ; on n'enregistre l'entrée d'historique qu'une fois que
// l'utilisateur s'est arrêté, pour éviter une entrée par caractère tapé.
const HISTORY_DEBOUNCE_MS = 600

const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="2"/></svg>`
const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M10 11v6M14 11v6M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12l5 5L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const ARTICLES = [
  { m: "Le", f: "La" },
  { m: "Un", f: "Une" },
  { m: "Mon", f: "Ma" },
  { m: "Ton", f: "Ta" },
]

// Le compteur "nombre de mots" (2-6) inclut l'article et le préfixe quand ils
// sont présents, d'où le décalage par rapport aux slots préfixes/suffixes.
// Il n'y a jamais plus d'un préfixe : les mots supplémentaires vont tous en suffixes.
const SLOT_DISTRIBUTION = {
  2: { article: false, prefixes: 0, suffixes: 1 },
  3: { article: true, prefixes: 0, suffixes: 1 },
  4: { article: true, prefixes: 1, suffixes: 1 },
  5: { article: true, prefixes: 1, suffixes: 2 },
  6: { article: true, prefixes: 1, suffixes: 3 },
}

const countInput = document.getElementById("countInput")
const countLabel = document.getElementById("countLabel")
const digitsInput = document.getElementById("digitsInput")
const specialInput = document.getElementById("specialInput")
const phraseDisplay = document.getElementById("phraseDisplay")
const copyMainBtn = document.getElementById("copyMainBtn")
const regenerateBtn = document.getElementById("regenerateBtn")
const customWordInput = document.getElementById("customWordInput")
const customGenderRadios = document.querySelectorAll(
  'input[name="customGender"]',
)
const separatorRadios = document.querySelectorAll('input[name="separator"]')
const gaugeFill = document.getElementById("gaugeFill")
const gaugeLabel = document.getElementById("gaugeLabel")
const strengthTime = document.getElementById("strengthTime")

const historyBtn = document.getElementById("historyBtn")
const historyDialog = document.getElementById("historyDialog")
const historyCloseBtn = document.getElementById("historyCloseBtn")
const historyList = document.getElementById("historyList")
const historyEmpty = document.getElementById("historyEmpty")
const historyClearBtn = document.getElementById("historyClearBtn")

const funFactCard = document.querySelector(".fun-fact")
const funFactText = document.getElementById("funFactText")
const funFactDots = document.getElementById("funFactDots")
const funFactPrevBtn = document.getElementById("funFactPrevBtn")
const funFactNextBtn = document.getElementById("funFactNextBtn")
const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
)

let wordData = null
let bitsRange = { min: 0, max: 1 }

let funFacts = []
let funFactIndex = 0
let funFactTimer = null

let history = loadHistory()
let historyDebounceTimer = null

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function pickDistinct(list, count) {
  const shuffled = [...list].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function permutations(n, r) {
  let result = 1
  for (let i = 0; i < r; i++) {
    result *= n - i
  }
  return result
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function pickCentralWord(options) {
  if (options.customWord) {
    return {
      text: capitalize(options.customWord),
      gender: options.customGender,
    }
  }
  return pickOne(wordData.words)
}

function buildPhrase(options) {
  const { count, digits, special, separator } = options
  const slots = SLOT_DISTRIBUTION[count]

  const word = pickCentralWord(options)
  const gender = word.gender

  const prefixes = pickDistinct(wordData.prefixes, slots.prefixes).map(
    (p) => p[gender],
  )
  const suffixes = pickDistinct(wordData.suffixes, slots.suffixes).map(
    (s) => s[gender],
  )

  const segments = []
  if (slots.article) segments.push(pickOne(ARTICLES)[gender])
  segments.push(...prefixes, word.text, ...suffixes)

  let phrase = segments.join(separator)

  if (special) {
    phrase += pickOne(SPECIAL_CHARS)
  }
  if (digits) {
    phrase += pickOne(wordData.numbers)
  }

  return phrase
}

function computeBits(options) {
  const { count, digits, special } = options
  const slots = SLOT_DISTRIBUTION[count]

  // Un mot personnalisé n'est pas tiré de wordData.words, mais on ne sait rien
  // de sa nature (mot commun ou chaîne aléatoire) : il apporte donc la même
  // incertitude qu'un tirage dans la liste, ni plus ni moins.
  let combinations =
    (slots.article ? ARTICLES.length : 1) *
    wordData.words.length *
    permutations(wordData.prefixes.length, slots.prefixes) *
    permutations(wordData.suffixes.length, slots.suffixes)

  if (digits) combinations *= wordData.numbers.length
  if (special) combinations *= SPECIAL_CHARS.length

  return Math.log2(combinations)
}

// La plage de bits réellement atteignable dépend de la taille des listes
// chargées (échantillon aujourd'hui, vraies listes ensuite). On calibre donc
// la jauge entre le pire cas (2 mots, sans options) et le meilleur cas
// (6 mots, chiffres + caractère spécial) plutôt que sur des seuils de bits
// fixes, sinon la jauge peut plafonner artificiellement avec de petites listes.
//
// Les paliers ne sont pas des fractions arbitraires de cette plage : un mot
// supplémentaire (~4-5 bits) pèse plus lourd que l'ajout des chiffres ou du
// caractère spécial (~3 bits chacun), donc un découpage 0.25/0.5/0.75 fait
// passer "4 mots + chiffres + spécial" en "moyen" alors que c'est déjà une
// combinaison solide. On calibre donc les seuils "fort" et "très fort" sur
// des configurations concrètes plutôt que sur des fractions uniformes.
function computeBitsRange() {
  const min = computeBits({ count: 2, digits: false, special: false })
  const max = computeBits({ count: 6, digits: true, special: true })
  const fortRef = computeBits({ count: 4, digits: true, special: true })
  const veryStrongRef = computeBits({ count: 5, digits: true, special: true })
  const span = max - min
  const moyenThreshold = (fortRef - min) / span / 2

  return {
    min,
    max,
    vulnerableThreshold: moyenThreshold / 2,
    moyenThreshold,
    fortThreshold: (fortRef - min) / span,
    veryStrongThreshold: (veryStrongRef - min) / span,
  }
}

function computeStrength(options) {
  const bits = computeBits(options)
  const span = bitsRange.max - bitsRange.min
  const percent =
    span > 0 ? Math.min(Math.max((bits - bitsRange.min) / span, 0), 1) : 1

  return { percent, timeLabel: formatCrackTime(percent) }
}

const LEVELS = [
  { label: "vulnérable", color: "#7b241c", crackTime: "moins d’une seconde" },
  { label: "faible", color: "#c0392b", crackTime: "quelques secondes" },
  { label: "moyen", color: "#a15b0a", crackTime: "quelques jours" },
  { label: "fort", color: "#1c7a43", crackTime: "quelques années" },
  { label: "très fort", color: "#1e8449", crackTime: "des milliers d’années" },
]

// Bornes séparant les 5 niveaux ci-dessus, alignées sur computeBitsRange().
function levelBounds() {
  return [
    0,
    bitsRange.vulnerableThreshold,
    bitsRange.moyenThreshold,
    bitsRange.fortThreshold,
    bitsRange.veryStrongThreshold,
    1,
  ]
}

// Paliers alignés sur strengthLevel() : une estimation simplifiée relative à
// la plage min/max atteignable avec les listes chargées, pas une vraie mesure
// d'entropie cryptographique, pour que le libellé de temps et le niveau de
// sécurité racontent toujours la même histoire.
function formatCrackTime(percent) {
  return strengthLevel(percent).crackTime
}

function strengthLevel(percent) {
  const bounds = levelBounds()
  const index = bounds.slice(1, -1).findIndex((bound) => percent < bound)
  return LEVELS[index === -1 ? LEVELS.length - 1 : index]
}

// Les seuils entre niveaux ne sont pas équidistants (un mot de plus pèse plus
// que l'ajout des chiffres/spécial, voir computeBitsRange), donc utiliser le
// pourcentage brut pour le remplissage de la jauge écrase visuellement les
// niveaux les uns contre les autres. On répartit donc chaque niveau sur une
// tranche égale de la jauge (1/5 chacun), en interpolant la position à
// l'intérieur de la tranche pour garder un retour visuel continu.
function computeVisualPercent(percent) {
  const bounds = levelBounds()
  const segments = bounds.length - 1

  for (let i = 0; i < segments; i++) {
    const start = bounds[i]
    const end = bounds[i + 1]
    if (percent < end || i === segments - 1) {
      const localRatio = end > start ? (percent - start) / (end - start) : 0
      return (i + Math.min(Math.max(localRatio, 0), 1)) / segments
    }
  }
  return 1
}

function updateGauge(percent) {
  const level = strengthLevel(percent)
  const visualPercent = computeVisualPercent(percent)
  // stroke-linecap: round dessine un point même pour un tracé de longueur
  // nulle ; à 0 % on masque donc entièrement le remplissage plutôt que de
  // laisser ce point parasite s'afficher sur le tracé.
  gaugeFill.style.opacity = percent > 0 ? "1" : "0"
  gaugeFill.style.strokeDashoffset = String(
    GAUGE_ARC_LENGTH * (1 - visualPercent),
  )
  gaugeFill.style.stroke = level.color
  gaugeLabel.textContent = level.label
  gaugeLabel.style.background = level.color
}

function readOptions() {
  const customGender = document.querySelector(
    'input[name="customGender"]:checked',
  ).value
  const separator = document.querySelector(
    'input[name="separator"]:checked',
  ).value

  return {
    count: Number(countInput.value),
    digits: digitsInput.checked,
    special: specialInput.checked,
    customWord: customWordInput.value.trim(),
    customGender,
    separator,
  }
}

function generateAll() {
  const options = readOptions()
  const phrase = buildPhrase(options)

  phraseDisplay.textContent = phrase
  scheduleHistoryEntry(phrase)

  const { percent, timeLabel } = computeStrength(options)
  updateGauge(percent)
  strengthTime.innerHTML = `Il faudrait <strong>${timeLabel}</strong> pour deviner ce mot de passe.`
}

function renderFunFact(index) {
  funFactIndex = index
  funFactText.textContent = funFacts[index]
  ;[...funFactDots.children].forEach((dot, i) => {
    if (i === index) {
      dot.setAttribute("aria-current", "true")
    } else {
      dot.removeAttribute("aria-current")
    }
  })
}

function buildFunFactDots() {
  funFactDots.innerHTML = ""

  funFacts.forEach((_, i) => {
    const dot = document.createElement("button")
    dot.type = "button"
    dot.className = "fun-fact-dot"
    dot.setAttribute("aria-label", `Anecdote ${i + 1}`)
    dot.addEventListener("click", () => goToFact(i))
    funFactDots.appendChild(dot)
  })
}

function goToFact(index) {
  const nextIndex = (index + funFacts.length) % funFacts.length

  funFactText.classList.add("is-fading")
  setTimeout(() => {
    renderFunFact(nextIndex)
    funFactText.classList.remove("is-fading")
  }, 150)

  restartAutoRotate()
}

function nextFact() {
  goToFact(funFactIndex + 1)
}

function prevFact() {
  goToFact(funFactIndex - 1)
}

function startAutoRotate() {
  if (prefersReducedMotion.matches || funFacts.length === 0) return
  funFactTimer = setInterval(nextFact, FUN_FACT_INTERVAL_MS)
}

function stopAutoRotate() {
  clearInterval(funFactTimer)
}

function restartAutoRotate() {
  stopAutoRotate()
  startAutoRotate()
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history))
  } catch {
    // stockage indisponible (navigation privée, quota dépassé...) : on continue sans persister
  }
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}

function formatHistoryDate(timestamp) {
  return new Date(timestamp).toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function addHistoryEntry(phrase) {
  if (history[0]?.phrase === phrase) return

  history.unshift({ phrase, timestamp: Date.now() })
  history = history.slice(0, MAX_HISTORY)
  saveHistory()
  if (historyDialog.open) renderHistoryList()
}

function scheduleHistoryEntry(phrase) {
  clearTimeout(historyDebounceTimer)
  historyDebounceTimer = setTimeout(
    () => addHistoryEntry(phrase),
    HISTORY_DEBOUNCE_MS,
  )
}

function deleteHistoryEntry(index) {
  history.splice(index, 1)
  saveHistory()
  renderHistoryList()
}

function clearHistory() {
  history = []
  saveHistory()
  renderHistoryList()
}

function renderHistoryList() {
  historyList.innerHTML = history
    .map(
      (entry, index) => `
        <li class="history-item">
          <div class="history-item-text">
            <code class="history-item-phrase">${escapeHtml(entry.phrase)}</code>
            <p class="history-item-date">${formatHistoryDate(entry.timestamp)}</p>
          </div>
          <div class="history-item-actions">
            <button class="history-item-btn" type="button" data-action="copy" data-index="${index}" aria-label="Copier cette pass-phrase">${COPY_ICON}</button>
            <button class="history-item-btn" type="button" data-action="delete" data-index="${index}" aria-label="Supprimer cette pass-phrase de l'historique">${TRASH_ICON}</button>
          </div>
        </li>`,
    )
    .join("")

  historyList.hidden = history.length === 0
  historyEmpty.hidden = history.length > 0
  historyClearBtn.hidden = history.length === 0
}

function copyHistoryItem(phrase, button) {
  navigator.clipboard.writeText(phrase).then(() => {
    const original = button.innerHTML
    button.classList.add("copied")
    button.innerHTML = CHECK_ICON
    setTimeout(() => {
      button.innerHTML = original
      button.classList.remove("copied")
    }, 1200)
  })
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent
    const wasOutline = button.classList.contains("btn-subtle")
    if (wasOutline) button.classList.add("copied")
    button.textContent = wasOutline ? "Copié !" : "✓"
    setTimeout(() => {
      button.textContent = original
      if (wasOutline) button.classList.remove("copied")
    }, 1500)
  })
}

countInput.addEventListener("input", () => {
  countLabel.textContent = `${countInput.value} mots`
  generateAll()
})
digitsInput.addEventListener("change", generateAll)
specialInput.addEventListener("change", generateAll)
customWordInput.addEventListener("input", generateAll)
customGenderRadios.forEach((r) => r.addEventListener("change", generateAll))
separatorRadios.forEach((r) => r.addEventListener("change", generateAll))
regenerateBtn.addEventListener("click", generateAll)
copyMainBtn.addEventListener("click", () =>
  copyToClipboard(phraseDisplay.textContent, copyMainBtn),
)

historyBtn.addEventListener("click", () => {
  renderHistoryList()
  historyDialog.showModal()
})
historyCloseBtn.addEventListener("click", () => historyDialog.close())
historyDialog.addEventListener("click", (e) => {
  if (e.target === historyDialog) historyDialog.close()
})
historyClearBtn.addEventListener("click", clearHistory)
historyList.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]")
  if (!button) return

  const index = Number(button.dataset.index)
  if (button.dataset.action === "copy") {
    copyHistoryItem(history[index].phrase, button)
  } else if (button.dataset.action === "delete") {
    deleteHistoryEntry(index)
  }
})

funFactPrevBtn.addEventListener("click", prevFact)
funFactNextBtn.addEventListener("click", nextFact)
funFactCard.addEventListener("mouseenter", stopAutoRotate)
funFactCard.addEventListener("mouseleave", startAutoRotate)
funFactCard.addEventListener("focusin", stopAutoRotate)
funFactCard.addEventListener("focusout", startAutoRotate)
prefersReducedMotion.addEventListener("change", (e) =>
  e.matches ? stopAutoRotate() : startAutoRotate(),
)

fetch("words.json")
  .then((res) => res.json())
  .then((data) => {
    wordData = data
    bitsRange = computeBitsRange()
    generateAll()
  })

fetch("funfacts.json")
  .then((res) => res.json())
  .then((data) => {
    funFacts = data.facts
    buildFunFactDots()
    renderFunFact(0)
    startAutoRotate()
  })

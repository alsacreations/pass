const SPECIAL_CHARS = ["!", "?", "#", "%", "*", "+", "@"]
const LEET_SUBSTITUTIONS = { e: "3", a: "4", l: "1", s: "5" }
const GAUGE_ARC_LENGTH = 157 // longueur du demi-cercle SVG (π × rayon 50)
const FUN_FACT_INTERVAL_MS = 10000
// Ancienne clé de l'historique persistant : on la purge au chargement pour
// effacer les pass-phrases laissées par les versions précédentes de l'outil.
const LEGACY_HISTORY_STORAGE_KEY = "pass-history"
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

// Devant un nom commençant par une voyelle ou un h muet : « L'Éléphant »,
// « Mon Armoire », « Bel Hippopotame »… Le h aspiré (« Le Hibou ») est le cas
// par défaut, donc seuls les noms en h muet des listes sont recensés ici.
// Les préfixes commencent tous par une consonne : l'article placé devant
// un préfixe ne change jamais.
// Le y initial se comporte comme une consonne : « Le Yaourt », « La Yourte ».
const STARTS_WITH_VOWEL = /^[aàâäeéèêëiîïoôöuùûü]/i
const H_MUET = new Set([
  "harmonica",
  "hélicoptère",
  "hippocampe",
  "hippopotame",
  "hortensia",
  "huître",
])
const ELIDED_ARTICLES = { Le: "L'", La: "L'", Ma: "Mon", Ta: "Ton" }
const ELIDED_PREFIXES = {
  Beau: "Bel",
  Fou: "Fol",
  Vieux: "Vieil",
  Nouveau: "Nouvel",
}

function startsWithVowelSound(text) {
  return STARTS_WITH_VOWEL.test(text) || H_MUET.has(text.toLowerCase())
}

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
const leetInput = document.getElementById("leetInput")
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

let funFacts = []
let funFactIndex = 0
let funFactTimer = null

// L'historique ne vit qu'en mémoire, le temps de l'onglet : rien n'est écrit
// dans le navigateur ni envoyé où que ce soit. Fermer l'onglet l'efface.
let history = []
let historyDebounceTimer = null

purgeLegacyHistory()

// Entier aléatoire uniforme dans [0, max), tiré par le générateur
// cryptographique du navigateur (Math.random n'est pas fait pour des secrets).
// Le rejet des valeurs hautes évite le biais du modulo.
function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max
  const buffer = new Uint32Array(1)
  do {
    crypto.getRandomValues(buffer)
  } while (buffer[0] >= limit)
  return buffer[0] % max
}

function pickOne(list) {
  return list[randomInt(list.length)]
}

// Mélange de Fisher-Yates partiel : seuls les `count` premiers éléments sont
// tirés, chacun uniformément parmi ceux qui restent.
function pickDistinct(list, count) {
  const pool = [...list]
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(pool.length - i)
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
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
  const { count, digits, special, leet, separator } = options
  const slots = SLOT_DISTRIBUTION[count]

  const word = pickCentralWord(options)
  const gender = word.gender

  const prefixes = pickDistinct(wordData.prefixes, slots.prefixes).map((p) =>
    gender === "m" && ELIDED_PREFIXES[p.m] && startsWithVowelSound(word.text)
      ? ELIDED_PREFIXES[p.m]
      : p[gender],
  )
  const suffixes = pickDistinct(wordData.suffixes, slots.suffixes).map(
    (s) => s[gender],
  )

  const body = [...prefixes, word.text, ...suffixes].join(separator)
  let joined = body
  if (slots.article) {
    const article = pickOne(ARTICLES)[gender]
    const elided = startsWithVowelSound(prefixes[0] ?? word.text)
      ? (ELIDED_ARTICLES[article] ?? article)
      : article
    // « L' » se colle au mot suivant, sans séparateur.
    joined = elided.endsWith("'") ? elided + body : elided + separator + body
  }

  // Substitution "leet" optionnelle, appliquée avant l'ajout des extras.
  const phrase = leet ? applySubstitutions(joined) : joined

  // Caractère spécial puis chiffre, toujours accolés en fin de phrase.
  const extras =
    (special ? pickOne(SPECIAL_CHARS) : "") +
    (digits ? pickOne(wordData.numbers) : "")

  return phrase + extras
}

// Une seule substitution par phrase : on choisit au hasard une occurrence
// parmi les lettres substituables (insensible à la casse). Une lettre doublée
// ("ss", "ll"…) compte comme une seule occurrence et est remplacée en bloc ("55").
function applySubstitutions(text) {
  const runs = [...text.matchAll(/([easl])\1*/gi)]
  if (runs.length === 0) return text

  const { 0: run, index } = pickOne(runs)
  const replacement = LEET_SUBSTITUTIONS[run[0].toLowerCase()].repeat(
    run.length,
  )
  return text.slice(0, index) + replacement + text.slice(index + run.length)
}

// Nombre moyen d'occurrences substituables (cf. applySubstitutions) dans une
// liste d'éléments, toutes formes confondues (masculin/féminin).
function averageSubstitutableRuns(forms) {
  const total = forms.reduce(
    (sum, form) => sum + [...form.matchAll(/([easl])\1*/gi)].length,
    0,
  )
  return total / forms.length
}

// Nombre moyen de positions candidates à la substitution leet pour une
// distribution donnée : somme des moyennes de chaque segment de la phrase.
function expectedSubstitutionPositions(slots) {
  const genderForms = (list) => list.flatMap((item) => [item.m, item.f])
  return (
    (slots.article ? averageSubstitutableRuns(genderForms(ARTICLES)) : 0) +
    slots.prefixes * averageSubstitutableRuns(genderForms(wordData.prefixes)) +
    averageSubstitutableRuns(wordData.words.map((w) => w.text)) +
    slots.suffixes * averageSubstitutableRuns(genderForms(wordData.suffixes))
  )
}

function computeBits(options) {
  const { count, digits, special, leet, customWord } = options
  const slots = SLOT_DISTRIBUTION[count]

  // Un mot personnalisé est choisi par l'utilisateur, souvent en lien avec
  // le site ou avec lui-même : on le considère comme connu de l'attaquant et
  // il n'apporte donc aucune incertitude.
  let combinations =
    (slots.article ? ARTICLES.length : 1) *
    (customWord ? 1 : wordData.words.length) *
    permutations(wordData.prefixes.length, slots.prefixes) *
    permutations(wordData.suffixes.length, slots.suffixes)

  // Les extras sont à position fixe (fin de phrase) : seule leur valeur
  // apporte de l'incertitude.
  if (digits) combinations *= wordData.numbers.length
  if (special) combinations *= SPECIAL_CHARS.length

  // La substitution leet porte sur une position tirée parmi les occurrences
  // substituables de la phrase. Leur nombre dépend des mots tirés : on utilise
  // donc une moyenne calculée sur les listes (estimation, pas une valeur exacte).
  if (leet) combinations *= Math.max(expectedSubstitutionPositions(slots), 1)

  return Math.log2(combinations)
}

// La jauge n'affiche pas de durée : elle varierait d'un facteur 10 000 selon
// le scénario (attaque en ligne ou vol de la base de données d'un site).
// La comparaison avec un mot de passe moyen, elle, reste vraie quel que soit
// le rythme de l'attaquant.

// Ordre de grandeur de la difficulté à deviner un mot de passe « moyen »
// choisi par un humain (prénom + année, mot du dictionnaire + chiffre…) :
// les études sur les fuites de mots de passe l'estiment autour de 20 bits,
// soit environ un million d'essais.
const TYPICAL_PASSWORD_BITS = 20

// Niveaux en bits d'entropie, calés sur les mots de passe réels plutôt que
// sur un idéal : « vulnérable » correspond à un mot de passe moyen, « fort »
// à une pass-phrase de 4 mots, « très fort » à ce que l'on recommande
// pour les comptes importants (messagerie, banque, gestionnaire…).
const LEVELS = [
  {
    label: "vulnérable",
    color: "#7b241c",
    advice: "Ajoutez un mot pour la rendre bien plus solide.",
  },
  {
    label: "faible",
    color: "#c0392b",
    advice: "Ajoutez un mot pour la rendre bien plus solide.",
  },
  {
    label: "moyen",
    color: "#a15b0a",
    advice: "Suffisant pour un compte sans importance. Un mot de plus&#8239;?",
  },
  {
    label: "fort",
    color: "#1c7a43",
    advice:
      "Idéal au quotidien. Pour la messagerie ou la banque, ajoutez un mot.",
  },
  {
    label: "très fort",
    color: "#1e8449",
    advice: "Parfait, même pour vos comptes les plus importants.",
  },
]
const LEVEL_BOUNDS = [15, 21, 25, 28, 35, 45]

function strengthLevel(bits) {
  const index = LEVEL_BOUNDS.slice(1, -1).findIndex((bound) => bits < bound)
  return LEVELS[index === -1 ? LEVELS.length - 1 : index]
}

// Combien de fois plus d'essais qu'un mot de passe moyen, en toutes lettres
// au-delà du million pour rester lisible.
function formatComparison(bits) {
  const ratio = 2 ** (bits - TYPICAL_PASSWORD_BITS)
  if (ratio < 2) return null
  if (ratio >= 1e9) return "des milliards de fois"
  if (ratio >= 1e6) return "des millions de fois"
  const rounded = Number(ratio.toPrecision(ratio < 100 ? 1 : 2))
  return `${rounded.toLocaleString("fr-FR")} fois`
}

// Chaque niveau occupe une tranche égale de la jauge (1/5), en interpolant
// la position à l'intérieur de la tranche pour garder un retour continu.
function computeVisualPercent(bits) {
  const segments = LEVEL_BOUNDS.length - 1
  for (let i = 0; i < segments; i++) {
    const start = LEVEL_BOUNDS[i]
    const end = LEVEL_BOUNDS[i + 1]
    if (bits < end || i === segments - 1) {
      const localRatio = (bits - start) / (end - start)
      return (i + Math.min(Math.max(localRatio, 0), 1)) / segments
    }
  }
  return 1
}

function updateGauge(bits) {
  const level = strengthLevel(bits)
  const visualPercent = computeVisualPercent(bits)
  // stroke-linecap: round dessine un point même pour un tracé de longueur
  // nulle ; à 0 % on masque donc entièrement le remplissage plutôt que de
  // laisser ce point parasite s'afficher sur le tracé.
  gaugeFill.style.opacity = visualPercent > 0 ? "1" : "0"
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
    leet: leetInput.checked,
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

  const bits = computeBits(options)
  updateGauge(bits)
  const comparison = formatComparison(bits)
  const versus = comparison
    ? `C’est <strong>${comparison} plus difficile</strong> à deviner qu’un mot de passe moyen comme «&nbsp;Patrick1965&nbsp;».`
    : "Ce n’est <strong>pas plus sûr</strong> qu’un mot de passe moyen comme «&nbsp;Patrick1965&nbsp;»."
  strengthTime.innerHTML = `${versus}<br>${strengthLevel(bits).advice}<br><strong>Attention&#8239;: aucun mot de passe n'est inviolable&#8239;!</strong>`
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

function purgeLegacyHistory() {
  try {
    localStorage.removeItem(LEGACY_HISTORY_STORAGE_KEY)
  } catch {
    // stockage indisponible (navigation privée, site bloqué…) : rien à purger
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
  renderHistoryList()
}

function clearHistory() {
  history = []
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
leetInput.addEventListener("change", generateAll)
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

fetch("assets/words.json")
  .then((res) => res.json())
  .then((data) => {
    wordData = data
    generateAll()
  })

fetch("assets/funfacts.json")
  .then((res) => res.json())
  .then((data) => {
    funFacts = data.facts
    buildFunFactDots()
    renderFunFact(0)
    startAutoRotate()
  })

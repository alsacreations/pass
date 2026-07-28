const SPECIAL_CHARS = ['!', '?', '#', '%', '*', '+', '@'];
const GAUGE_ARC_LENGTH = 157; // longueur du demi-cercle SVG (π × rayon 50)

const ARTICLES = [
  { m: 'Le', f: 'La' },
  { m: 'Un', f: 'Une' },
  { m: 'Mon', f: 'Ma' },
];

// Le compteur "nombre de mots" (4-6) inclut désormais l'article ajouté en
// tête de phrase, d'où le décalage par rapport aux slots préfixes/suffixes.
// Il n'y a jamais plus d'un préfixe : les mots supplémentaires vont tous en suffixes.
const SLOT_DISTRIBUTION = {
  4: { prefixes: 1, suffixes: 1 },
  5: { prefixes: 1, suffixes: 2 },
  6: { prefixes: 1, suffixes: 3 },
};

const countInput = document.getElementById('countInput');
const countLabel = document.getElementById('countLabel');
const digitsInput = document.getElementById('digitsInput');
const specialInput = document.getElementById('specialInput');
const phraseDisplay = document.getElementById('phraseDisplay');
const copyMainBtn = document.getElementById('copyMainBtn');
const regenerateBtn = document.getElementById('regenerateBtn');
const customWordInput = document.getElementById('customWordInput');
const customGenderRadios = document.querySelectorAll('input[name="customGender"]');
const gaugeFill = document.getElementById('gaugeFill');
const gaugeLabel = document.getElementById('gaugeLabel');
const strengthTime = document.getElementById('strengthTime');

let wordData = null;
let bitsRange = { min: 0, max: 1 };

function pickOne(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickDistinct(list, count) {
  const shuffled = [...list].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function permutations(n, r) {
  let result = 1;
  for (let i = 0; i < r; i++) {
    result *= n - i;
  }
  return result;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pickCentralWord(options) {
  if (options.customWord) {
    return { text: capitalize(options.customWord), gender: options.customGender };
  }
  return pickOne(wordData.words);
}

function buildPhrase(options) {
  const { count, digits, special } = options;
  const slots = SLOT_DISTRIBUTION[count];

  const word = pickCentralWord(options);
  const gender = word.gender;

  const article = pickOne(ARTICLES)[gender];
  const prefixes = pickDistinct(wordData.prefixes, slots.prefixes).map((p) => p[gender]);
  const suffixes = pickDistinct(wordData.suffixes, slots.suffixes).map((s) => s[gender]);

  const segments = [article, ...prefixes, word.text, ...suffixes];
  let phrase = segments.join('-');

  if (digits) {
    phrase += String(Math.floor(Math.random() * 99) + 1);
  }
  if (special) {
    phrase += pickOne(SPECIAL_CHARS);
  }

  return phrase;
}

function computeBits(options) {
  const { count, digits, special, customWord } = options;
  const slots = SLOT_DISTRIBUTION[count];

  // Un mot personnalisé est un choix fixe connu de l'utilisateur : il n'apporte
  // pas l'incertitude d'un tirage dans la liste, donc son facteur vaut 1.
  const wordsFactor = customWord ? 1 : wordData.words.length;

  let combinations =
    ARTICLES.length *
    wordsFactor *
    permutations(wordData.prefixes.length, slots.prefixes) *
    permutations(wordData.suffixes.length, slots.suffixes);

  if (digits) combinations *= 99;
  if (special) combinations *= SPECIAL_CHARS.length;

  return Math.log2(combinations);
}

// La plage de bits réellement atteignable dépend de la taille des listes
// chargées (échantillon aujourd'hui, vraies listes ensuite). On calibre donc
// la jauge entre le pire cas (4 mots, sans options) et le meilleur cas
// (6 mots, chiffres + caractère spécial) plutôt que sur des seuils de bits
// fixes, sinon la jauge peut plafonner artificiellement avec de petites listes.
function computeBitsRange() {
  return {
    min: computeBits({ count: 4, digits: false, special: false }),
    max: computeBits({ count: 6, digits: true, special: true }),
  };
}

function computeStrength(options) {
  const bits = computeBits(options);
  const span = bitsRange.max - bitsRange.min;
  const percent = span > 0 ? Math.min(Math.max((bits - bitsRange.min) / span, 0), 1) : 1;

  return { percent, timeLabel: formatCrackTime(percent) };
}

// Paliers alignés sur strengthLevel() : une estimation simplifiée relative à
// la plage min/max atteignable avec les listes chargées, pas une vraie mesure
// d'entropie cryptographique, pour que le libellé de temps et le niveau de
// sécurité racontent toujours la même histoire.
function formatCrackTime(percent) {
  if (percent < 0.25) return 'quelques secondes';
  if (percent < 0.5) return 'quelques jours';
  if (percent < 0.75) return 'quelques années';
  return 'des milliers d’années';
}

function strengthLevel(percent) {
  if (percent < 0.25) return { label: 'faible', color: '#e74c3c' };
  if (percent < 0.5) return { label: 'moyen', color: '#f39c12' };
  if (percent < 0.75) return { label: 'fort', color: '#27ae60' };
  return { label: 'très fort', color: '#1e8449' };
}

function updateGauge(percent) {
  const level = strengthLevel(percent);
  // stroke-linecap: round dessine un point même pour un tracé de longueur
  // nulle ; à 0 % on masque donc entièrement le remplissage plutôt que de
  // laisser ce point parasite s'afficher sur le tracé.
  gaugeFill.style.opacity = percent > 0 ? '1' : '0';
  gaugeFill.style.strokeDashoffset = String(GAUGE_ARC_LENGTH * (1 - percent));
  gaugeFill.style.stroke = level.color;
  gaugeLabel.textContent = level.label;
  gaugeLabel.style.background = level.color;
}

function readOptions() {
  const customGender = document.querySelector('input[name="customGender"]:checked').value;

  return {
    count: Number(countInput.value),
    digits: digitsInput.checked,
    special: specialInput.checked,
    customWord: customWordInput.value.trim(),
    customGender,
  };
}

function generateAll() {
  const options = readOptions();

  phraseDisplay.textContent = buildPhrase(options);

  const { percent, timeLabel } = computeStrength(options);
  updateGauge(percent);
  strengthTime.innerHTML = `Il faudrait <strong>${timeLabel}</strong> pour deviner cette phrase de passe`;
}

function copyToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    const original = button.textContent;
    const wasOutline = button.classList.contains('btn-outline');
    if (wasOutline) button.classList.add('copied');
    button.textContent = wasOutline ? 'Copié !' : '✓';
    setTimeout(() => {
      button.textContent = original;
      if (wasOutline) button.classList.remove('copied');
    }, 1500);
  });
}

countInput.addEventListener('input', () => {
  countLabel.textContent = `${countInput.value} mots`;
  generateAll();
});
digitsInput.addEventListener('change', generateAll);
specialInput.addEventListener('change', generateAll);
customWordInput.addEventListener('input', generateAll);
customGenderRadios.forEach((r) => r.addEventListener('change', generateAll));
regenerateBtn.addEventListener('click', generateAll);
copyMainBtn.addEventListener('click', () => copyToClipboard(phraseDisplay.textContent, copyMainBtn));

fetch('words.json')
  .then((res) => res.json())
  .then((data) => {
    wordData = data;
    bitsRange = computeBitsRange();
    generateAll();
  });

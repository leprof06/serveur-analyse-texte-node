// Évaluation de contenu multilingue pour réponses ouvertes.
// Modes : similarité (réponse type), mots-clés (all/any/banned), regex, contraintes longueur, verbe requis.
// Retourne : { contentScore, isCorrect, reasons[] }

import stringSimilarity from "string-similarity";
import nlp from "compromise";

// --- normalisation légère sans dépendances lourdes
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokens(s) {
  return norm(s).split(" ").filter(Boolean);
}

// --- petite liste stopwords minimale par langue (peut s’enrichir)
const STOP = {
  fr: ["le","la","les","un","une","des","de","du","et","en","à","au","aux","dans","pour","par","avec","sur","se","ce","cette","ces","est","sont"],
  en: ["the","a","an","and","in","on","to","for","with","of","is","are","this","that","these","those"],
  de: ["der","die","das","ein","eine","und","in","auf","zu","mit","von","ist","sind"],
  es: ["el","la","los","las","un","una","y","en","de","para","con","es","son"],
  ru: ["и","в","на","с","к","у","по","о","а","это","этот","эта","эти"],
  zh: [], ja: [], ko: [] // on garde tout côté CJK
};
function filterStop(words, lang) {
  const set = new Set(STOP[lang] || []);
  return words.filter(w => !set.has(w));
}

// --- similarité 0..100
function similarity100(a, b) {
  if (!a || !b) return 0;
  const score = stringSimilarity.compareTwoStrings(norm(a), norm(b));
  return Math.round(score * 100);
}

// --- comptage mots-clés
function countKeywords(text, list = []) {
  const base = norm(text);
  let found = 0;
  for (const k of list) {
    if (!k) continue;
    if (base.includes(norm(String(k)))) found++;
  }
  return { found, total: list.length, pct: list.length ? Math.round((found/list.length)*100) : null };
}

// --- verbe requis (heuristique légère, compromise marche mieux en EN ; FR heuristique suffixes/auxiliaires)
function hasVerb(text, lang) {
  const doc = nlp(text || "");
  if ((doc.verbs()?.out("array") || []).length > 0) return true;
  if (lang === "fr") {
    const lower = ` ${text.toLowerCase()} `;
    const hints = [" ai "," as "," a "," avons "," avez "," ont ",
                   " suis "," es "," est "," sommes "," êtes "," sont ",
                   "er ","ez ","e ","ons ","ent ","ait ","ais ","aient "];
    return hints.some(h => lower.includes(h));
  }
  return false;
}

// --- évaluation principale
export function evaluateAnswer(userText, evalCfg = {}, lang = "fr") {
  const reasons = [];
  let points = 0;
  let maxPoints = 0;

  const {
    expectedAnswer,                // string
    similarityThreshold = 70,      // %
    keywords = { all: [], any: [], banned: [] },
    anyAtLeast = 1,
    regex = [],                    // liste d'expressions (string ou RegExp)
    minWords = 0,
    maxWords = 0,
    requireVerb = false,
    weights = { similarity: 60, all: 25, any: 15, regex: 20, length: 10, verb: 10, penaltyBanned: 30 }
  } = evalCfg || {};

  const tok = tokens(userText);
  const wordCount = tok.length;

  // 1) Similarité (optionnel)
  if (expectedAnswer) {
    const sim = similarity100(userText, expectedAnswer);
    const w = weights.similarity || 0;
    const pts = Math.round((sim / 100) * w);
    points += pts; maxPoints += w;
    reasons.push({ rule: "similarity", value: sim, weight: w, points: pts, threshold: similarityThreshold });
  }

  // 2) Mots-clés obligatoires (all)
  if (keywords?.all?.length) {
    const { found, total, pct } = countKeywords(userText, keywords.all);
    const w = weights.all || 0;
    const ratio = total ? found / total : 0;
    const pts = Math.round(ratio * w);
    points += pts; maxPoints += w;
    reasons.push({ rule: "keywords_all", found, total, pct, weight: w, points: pts });
  }

  // 3) Mots-clés facultatifs (any)
  if (keywords?.any?.length) {
    const { found, total } = countKeywords(userText, keywords.any);
    const ok = found >= Math.max(1, anyAtLeast);
    const w = weights.any || 0;
    const pts = ok ? w : 0;
    points += pts; maxPoints += w;
    reasons.push({ rule: "keywords_any", found, total, required: anyAtLeast, weight: w, points: pts });
  }

  // 4) Interdits (banned) -> pénalité
  if (keywords?.banned?.length) {
    const { found } = countKeywords(userText, keywords.banned);
    if (found > 0) {
      const pen = Math.min(points, weights.penaltyBanned || 0);
      points -= pen;
      reasons.push({ rule: "keywords_banned", found, penalty: pen });
    } else {
      reasons.push({ rule: "keywords_banned", found: 0 });
    }
  }

  // 5) Regex (toutes doivent matcher si fournies)
  if (regex?.length) {
    let ok = true;
    for (const r of regex) {
      const re = r instanceof RegExp ? r : new RegExp(r, "i");
      if (!re.test(userText)) { ok = false; break; }
    }
    const w = weights.regex || 0;
    const pts = ok ? w : 0;
    points += pts; maxPoints += w;
    reasons.push({ rule: "regex", ok, weight: w, points: pts });
  }

  // 6) Longueur (entre min/max si fournis)
  if (minWords || maxWords) {
    const okMin = minWords ? wordCount >= minWords : true;
    const okMax = maxWords ? wordCount <= maxWords : true;
    const ok = okMin && okMax;
    const w = weights.length || 0;
    const pts = ok ? w : 0;
    points += pts; maxPoints += w;
    reasons.push({ rule: "length", wordCount, minWords, maxWords, weight: w, points: pts });
  }

  // 7) Verbe requis
  if (requireVerb) {
    const hv = hasVerb(userText, lang);
    const w = weights.verb || 0;
    const pts = hv ? w : 0;
    points += pts; maxPoints += w;
    reasons.push({ rule: "requireVerb", hasVerb: hv, weight: w, points: pts });
  }

  // Score final contenu (0..100) basé sur points/maxPoints (si aucune règle => 0 mais noté comme neutre)
  const contentScore = maxPoints > 0 ? Math.max(0, Math.min(100, Math.round((points / maxPoints) * 100))) : 0;

  // Règle « correct / incorrect »
  // - si expectedAnswer: on exige sim >= threshold
  // - sinon: on exige que ALL soit complet + ANY satisfaites + pas de banned + regex ok
  let isCorrect = false;
  if (expectedAnswer) {
    const sim = reasons.find(r => r.rule === "similarity")?.value ?? 0;
    isCorrect = sim >= similarityThreshold;
  } else {
    const all = reasons.find(r => r.rule === "keywords_all");
    const any = reasons.find(r => r.rule === "keywords_any");
    const banned = reasons.find(r => r.rule === "keywords_banned");
    const regexR = reasons.find(r => r.rule === "regex");
    const allOk = all ? (all.found === all.total) : true;
    const anyOk = any ? (any.points > 0) : true;
    const bannedOk = banned ? (banned.found === 0) : true;
    const regexOk = regexR ? (regexR.points > 0) : true;
    isCorrect = allOk && anyOk && bannedOk && regexOk;
  }

  return { contentScore, isCorrect, reasons };
}

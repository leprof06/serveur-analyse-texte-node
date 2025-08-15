import stringSimilarity from "string-similarity";
import nlp from "compromise";

// Normalise chaîne pour similarité
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Calcule un score de similarité 0-100 basé sur string-similarity.
 */
export function similarityScore(userText, expectedText) {
  if (!expectedText) return 0;
  const score = stringSimilarity.compareTwoStrings(norm(userText), norm(expectedText)); // 0..1
  return Math.round(score * 100);
}

/**
 * Score grammaire / orthographe simples:
 * - pénalité linéaire par erreur détectée (matches LT)
 * - plafonné 0..100
 */
export function grammarSpellingScores(matches) {
  const grammarWeight = Number(process.env.GRAMMAR_PTS_PER_ERROR || 6);
  const spellingWeight = Number(process.env.SPELLING_PTS_PER_ERROR || 5);

  let grammarErr = 0;
  let spellingErr = 0;

  for (const m of matches || []) {
    const t = m.rule?.issueType || "";
    // LanguageTool: "misspelling" "typographical" "grammar" "style" etc.
    if (/spelling|typographical/i.test(t) || /spelling/i.test(m.rule?.id || "")) spellingErr++;
    else grammarErr++;
  }
  const grammarScore = Math.max(0, 100 - grammarErr * grammarWeight);
  const spellingScore = Math.max(0, 100 - spellingErr * spellingWeight);

  return { grammarScore, spellingScore, grammarErr, spellingErr };
}

/**
 * Heuristiques de structure:
 * - hasVerb: compromis(e) détecte des verbes surtout pour EN; pour FR on regarde aussi quelques indices.
 * - keywordScore: % de mots-clés trouvés.
 */
export function structureHeuristics(text, expectedKeywords = [], lang = "fr") {
  const doc = nlp(text || "");
  const verbs = doc.verbs()?.out("array") || [];

  let hasVerb = verbs.length > 0;

  if (!hasVerb && lang === "fr") {
    // Indices FR simples: terminaisons / auxiliaires
    const lower = (text || "").toLowerCase();
    const hints = [" ai ", " as ", " a ", " avons ", " avez ", " ont ",
                   " suis ", " es ", " est ", " sommes ", " êtes ", " sont ",
                   "er ", "ez ", "e ", "ons ", "ent ", "ait ", "ais ", "aient "];
    hasVerb = hints.some(h => lower.includes(h));
  }

  // Score mots‑clés
  const base = (text || "").toLowerCase();
  let found = 0;
  for (const k of expectedKeywords || []) {
    if (!k) continue;
    if (base.includes(String(k).toLowerCase())) found++;
  }
  const keywordScore = expectedKeywords?.length ? Math.round((found / expectedKeywords.length) * 100) : null;

  return { hasVerb, keywordScore, found, total: expectedKeywords?.length || 0 };
}

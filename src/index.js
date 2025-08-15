// API Node/Express d’analyse de texte
// - Détection de langue (franc-min)
// - Appel LanguageTool (API publique ou self-host via LT_BASE_URL)
// - Similarité (string-similarity)
// - Heuristiques de structure (verbes & mots-clés)

import express from 'express';
import cors from 'cors';
import { franc } from 'franc-min';
import stringSimilarity from 'string-similarity';
import nlp from 'compromise';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ————— Config —————
const PORT = process.env.PORT || 3001;
const LT_BASE_URL = process.env.LT_BASE_URL || 'https://api.languagetool.org/v2';
const LT_API_KEY = process.env.LT_API_KEY || null; // optionnel (LT premium)

// Pondérations simples (ajustables via env)
const GRAMMAR_PTS_PER_ERROR = Number(process.env.GRAMMAR_PTS_PER_ERROR || 7);
const SPELLING_PTS_PER_ERROR = Number(process.env.SPELLING_PTS_PER_ERROR || 5);

// ————— Utilitaires —————
const iso3to2 = {
  fra: 'fr', deu: 'de', eng: 'en', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', kor: 'ko', jpn: 'ja', cmn: 'zh', nld: 'nl', pol: 'pl'
};

function normalize(text = '') {
  return text
    .toLowerCase()
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Liste courte de stopwords FR pour l’overlap de mots-clés
const STOP_FR = new Set([
  'le','la','les','un','une','des','du','de','d','et','ou','au','aux','en','dans','sur','sous','avec','sans','par','pour','vers','chez','que','qui','quoi','dont','où','je','tu','il','elle','on','nous','vous','ils','elles','mon','ton','son','ma','ta','sa','mes','tes','ses','notre','votre','leur','nos','vos','leurs','ce','cet','cette','ces','ne','pas','plus','moins','très','trop','bien','mal','comme','si','se','s','y','l','m','t','qu'
]);

function tokenizeFR(text) {
  // Tokenisation simple (compromise fonctionne surtout pour l’anglais)
  return normalize(text)
    .split(/[^a-zàâäéèêëîïôöùûüçœ'-]+/i)
    .filter(Boolean);
}

function keywordOverlap(a, b) {
  const A = new Set(tokenizeFR(a).filter(w => !STOP_FR.has(w)));
  const B = new Set(tokenizeFR(b).filter(w => !STOP_FR.has(w)));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return Math.round((inter / Math.min(A.size, B.size)) * 100);
}

function hasFrenchVerbHeuristic(text) {
  // Heuristique grossière : recherche d’auxiliaires + participes / terminaisons verbales fréquentes
  const t = tokenizeFR(text);
  const joined = ' ' + t.join(' ') + ' ';
  const aux = /(\sil\s|\sj[eai]\s|\st[uai]\s|\snous\s|\svous\s|\sils\s|\selles\s)?\s?(ai|as|a|avons|avez|ont|étais|était|étions|étiez|étaient|serai|seras|sera|serons|serez|seront)\s/i;
  const part = /\b(é|ée|és|ées|i|ie|is|ies|u|ue|us|ues)\b/i; // participes fréquents
  const endings = /\b(\w{3,}(er|ir|re|ais|ait|ions|iez|aient|rai|ras|ra|rons|rez|ront|rai[st]?|iez|âmes|âtes|èrent))\b/i;
  return aux.test(joined) || part.test(joined) || endings.test(joined);
}

async function callLanguageTool(text, lang) {
  const params = new URLSearchParams();
  params.set('text', text);
  params.set('language', lang || 'auto');
  params.set('enabledOnly', 'false');

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (LT_API_KEY) headers['Authorization'] = `Bearer ${LT_API_KEY}`;

  const t0 = Date.now();
  const res = await fetch(`${LT_BASE_URL}/check`, {
    method: 'POST',
    headers,
    body: params
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LanguageTool error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const ms = Date.now() - t0;
  return { ...data, elapsedMs: ms };
}

function categorizeMatches(matches = []) {
  const out = { spelling: [], grammar: [], other: [] };
  for (const m of matches) {
    const issueType = m.rule?.issueType || '';
    const catId = m.rule?.category?.id || '';
    if (issueType === 'misspelling' || catId === 'TYPOS') {
      out.spelling.push(m);
    } else if (issueType === 'grammar' || catId === 'GRAMMAR') {
      out.grammar.push(m);
    } else {
      out.other.push(m);
    }
  }
  return out;
}

function scoreFromErrors(count, ptsPerError) {
  return Math.max(0, 100 - count * ptsPerError);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'analyse-texte', ltBaseUrl: LT_BASE_URL });
});

app.post('/analyse-text', async (req, res) => {
  try {
    const { text = '', expectedAnswer = '', expectedLang = '' } = req.body || {};
    const cleanText = (text || '').toString().slice(0, 20000); // garde-fou

    // 1) Détection de langue
    const iso3 = franc(cleanText || '');
    const detectedLang = iso3to2[iso3] || 'und';

    // 2) Analyse LanguageTool
    const langForLT = expectedLang || detectedLang || 'auto';
    const lt = await callLanguageTool(cleanText, langForLT);
    const { matches = [], language } = lt;
    const cats = categorizeMatches(matches);

    // 3) Scores grammaire / orthographe (heuristique simple)
    const grammarScore = scoreFromErrors(cats.grammar.length, GRAMMAR_PTS_PER_ERROR);
    const spellingScore = scoreFromErrors(cats.spelling.length, SPELLING_PTS_PER_ERROR);

    // 4) Similarité (si expectedAnswer fourni)
    let similarityScore = null;
    if (expectedAnswer && cleanText) {
      const a = normalize(cleanText);
      const b = normalize(expectedAnswer);
      similarityScore = Math.round(stringSimilarity.compareTwoStrings(a, b) * 100);
    }

    // 5) Heuristiques de structure
    const hasVerb = hasFrenchVerbHeuristic(cleanText);
    const keywordScore = expectedAnswer ? keywordOverlap(cleanText, expectedAnswer) : null;

    // 6) Issues consolidées
    const issues = [];
    for (const m of cats.grammar) {
      issues.push({
        type: 'grammar',
        message: m.message,
        offset: m.offset,
        length: m.length,
        context: m.context?.text || undefined,
        replacements: (m.replacements || []).slice(0, 5).map(r => r.value)
      });
    }
    for (const m of cats.spelling) {
      issues.push({
        type: 'spelling',
        message: m.message,
        offset: m.offset,
        length: m.length,
        context: m.context?.text || undefined,
        replacements: (m.replacements || []).slice(0, 5).map(r => r.value)
      });
    }

    // 7) Avertissement de langue si mismatch
    let langWarning = null;
    if (expectedLang && detectedLang !== 'und' && expectedLang !== detectedLang) {
      langWarning = `La langue détectée est « ${detectedLang} » mais « ${expectedLang} » était attendue.`;
      issues.unshift({ type: 'language', message: langWarning });
    }

    res.json({
      lang: detectedLang,
      grammarScore,
      spellingScore,
      similarityScore,
      issues,
      details: {
        keywordScore,
        hasVerb,
        ltLanguage: language?.detectedLanguage?.code || language?.code || null,
        counts: {
          grammarErrors: cats.grammar.length,
          spellingErrors: cats.spelling.length,
          otherIssues: cats.other.length,
          totalIssues: matches.length
        },
        ltElapsedMs: lt.elapsedMs
      }
    });
  } catch (err) {
    const msg = err?.message || 'Unknown error';
    const is429 = /429/.test(msg);
    res.status(is429 ? 503 : 500).json({
      error: 'analysis_failed',
      message: msg,
      hint: is429 ? 'Limite atteinte sur LanguageTool public : fournissez LT_BASE_URL vers votre instance self-hostée.' : undefined
    });
  }
});

app.listen(PORT, () => {
  console.log(`[analyse-texte] listening on http://localhost:${PORT}`);
});

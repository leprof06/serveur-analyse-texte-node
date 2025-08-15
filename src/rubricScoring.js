import { grammarSpellingScores } from "./scoring.js";
import { organizationMetrics } from "./organization.js";
import { lexisMetrics } from "./lexis.js";
import { semanticSimilarity100 } from "./semantic.js"; // <-- corrige l'import

// Agrège selon le barème CECRL-like
export async function rubricAggregate({ text, lang, ltMatches, expectedAnswer, rubric }) {
  const w = rubric.weights;

  // 1) grammar/mechanics (depuis LT)
  const { grammarScore, spellingScore } = grammarSpellingScores(ltMatches);

  // 2) content -> sémantique (0..100). Si EMB indispo => null => 0.
  let sem = 0;
  if (expectedAnswer) {
    const s = await semanticSimilarity100(text, expectedAnswer);
    sem = Number.isFinite(s) ? s : 0; // s ∈ [0..100] ou null
  }
  const contentScore = expectedAnswer ? sem : 0;

  // 3) organization
  const org = organizationMetrics(text, lang);
  const organizationScore = Math.round((org.paraScore * 0.5) + (org.connScore * 0.5));

  // 4) lexis
  const lex = lexisMetrics(text, lang);
  const lexisScore = lex.lexisScore;

  // Agrégation pondérée
  const overall =
      (contentScore     * (w.content/100)) +
      (organizationScore* (w.organization/100)) +
      (lexisScore       * (w.lexis/100)) +
      (grammarScore     * (w.grammar/100)) +
      (spellingScore    * (w.mechanics/100));

  return {
    overall: Math.round(overall),
    breakdown: {
      content: Math.round(contentScore),
      organization: Math.round(organizationScore),
      lexis: Math.round(lexisScore),
      grammar: Math.round(grammarScore),
      mechanics: Math.round(spellingScore)
    },
    details: { semantic: contentScore, organization: org, lexis: lex }
  };
}

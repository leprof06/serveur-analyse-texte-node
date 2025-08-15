// Map franc-min (iso3) -> iso2 simplifié
export function iso3ToIso2(iso3) {
  const m = {
    fra:"fr", fre:"fr", eng:"en",
    deu:"de", ger:"de", spa:"es",
    ita:"it", por:"pt", rus:"ru",
    kor:"ko", jpn:"ja", cmn:"zh",
    nld:"nl", tur:"tr", pol:"pl",
    ara:"ar"
  };
  return m[iso3] || "und";
}

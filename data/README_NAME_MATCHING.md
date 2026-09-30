# International name-matching fixture

Prepared 2026-09-29. 50 unique full names: 25 female rows and 25 male rows. Synthetic test records, not a list of identified people.

## File contract

UTF-8 without BOM; comma delimiter; quoted fields; LF line endings; Unicode NFC; one header plus 50 data rows. Exactly four columns, in the requested order:

1. `name`: one given-name word followed by a one-word or two-word surname, using accented Latin spellings or identified romanizations.
2. `german_alphabet_variant`: each special letter replaced with its visually similar basic Latin letter. A–Z/a–z are a subset of the German alphabet. One source grapheme becomes one letter; case is preserved.
3. `special_characters_removed`: delete the ENTIRE special letter (base plus attached marks), not just its accent. Apply to every special letter, including German umlauts. Example: José → Jos; Đức → c; Gītā → Gt.
4. `gender`: female or male for the selected cultural usage/test persona; not a universal gender classifier.

## Replacement rules

Accents, macrons, tone marks, cedillas, rings, horns and dots are removed from letters while retaining their base character in column 2. Explicit non-decomposing mappings: Ł→L, ł→l, Đ→D, ı→i. Examples: İ→I, ư→u, ơ→o, Š→S, ñ→n, ü→u. Column 3 removes the original marked grapheme entirely.

These are deliberately mechanical visual mutations, not official German transliteration rules: ü→u rather than ue; Š→S rather than Sh. They should not be used to rewrite people's stored names.

## Coverage and evidence

25 country contexts, covering Africa, Asia, Europe, North America, South America and Oceania. Antarctica has no indigenous/permanent naming population and is not assigned an invented name tradition. Country associations are examples of usage, not exclusive origins.

The population coverage baseline is the [US Census Bureau's July 1, 2025 top ten](https://www.census.gov/popclock/population_widget_310x200.php): India, China, United States, Indonesia, Pakistan, Nigeria, Brazil, Bangladesh, Russia and Mexico. All ten are included, alongside Ethiopia, Japan, Egypt, Philippines, DR Congo and other countries. This is a dated coverage baseline, not a claim about exact 2026 rankings.

Selection favors familiar, established names rather than rare invented strings. Research establishes names and cultural usage; it does not establish a comparable national popularity rank for every exact accented spelling. In particular, scholarly romanizations and heritage spellings are intentionally included for character coverage and are not claimed to be the most common administrative spelling. Forebears is a secondary prevalence estimate, not a national census.

## Row-level source and country map

Data row numbers below exclude the CSV header. Each pair lists the female row followed by the male row. Sources may show the underlying name without the scholarly diacritics; the spelling note makes this distinction explicit.

| Data rows | Country context | Continent | Names (female; male) | Spelling / usage note | Sources |
|---|---|---|---|---|---|
| 1–2 | India | Asia | Gītā Sharma; Rāhul Verma | Scholarly Latin renderings of Gita and Rahul; everyday English spellings usually omit macrons. | [1](https://www.behindthename.com/name/gita-1), [2](https://en.wikipedia.org/wiki/Rahul), [3](https://en.wiktionary.org/wiki/गीता) |
| 3–4 | China | Asia | Lì Wáng; Wěi Zhāng | Tone-marked pinyin: 丽 (female example) and 伟 (male example). Other characters pronounced Li or Wei can have other gender associations. | [1](https://www.behindthename.com/name/li-1), [2](https://www.behindthename.com/name/wei), [3](https://en.wikipedia.org/wiki/Chinese_given_name) |
| 5–6 | United States | North America | Zoë Williams García; André Johnson Davis | Established international names used in the US; the accented spellings are not separately ranked here. | [1](https://www.behindthename.com/name/zoe), [2](https://www.behindthename.com/name/andre10) |
| 7–8 | Indonesia | Asia | Fāṭimah Nasution Siregar; Muḥammad Harahap | Scholarly Arabic renderings of Fatimah and Muhammad, both common Indonesian names. These diacritics are not usual Indonesian administrative spelling. | [1](https://www.behindthename.com/name/fatimah), [2](https://www.behindthename.com/name/muhammad), [3](https://forebears.io/indonesia/forenames) |
| 9–10 | Pakistan | Asia | Āminah Khan Malik; Aḥmad Shah Qureshi | Scholarly Arabic renderings of names also used in Pakistan; romanization varies. | [1](https://www.behindthename.com/name/aminah), [2](https://www.behindthename.com/name/ahmad) |
| 11–12 | Nigeria | Africa | Yétúndé Adéyẹmí; Bàbájídé Adébáyọ̀ | Yoruba tone-marked forms; the linguistic paper documents both spellings. | [1](https://www.behindthename.com/name/yetunde), [2](https://www.behindthename.com/name/babajide), [3](https://iling-ran.ru/library/languageinafrica/2/LiA_2_2_4_Akintoye.pdf) |
| 13–14 | Brazil | South America | Júlia Silva Santos; João Oliveira Pereira | Portuguese spellings used in Brazil. | [1](https://www.behindthename.com/name/ju10lia), [2](https://www.behindthename.com/name/joa14o) |
| 15–16 | Bangladesh | Asia | Nasrīn Chowdhury Rahman; Ḥasan Ahmed | Scholarly forms of names used in Bangladesh; Nasrin/Nasreen and Hasan are usual English renderings. | [1](https://www.behindthename.com/name/nasrin), [2](https://www.behindthename.com/name/hasan), [3](https://en.wikipedia.org/wiki/Nasrin) |
| 17–18 | Russia | Europe / Asia | Gölnara Karimova; Röstäm Karimov Yusupov | Tatar Latin forms, representing a naming community within Russia rather than ethnic-Russian names. | [1](https://www.behindthename.com/name/go12lnara), [2](https://www.behindthename.com/name/ro12sta12m) |
| 19–20 | Mexico | North America | María Hernández López; Jesús García | Spanish spellings; both are widely established Mexican names. | [1](https://www.behindthename.com/names/usage/spanish) |
| 21–22 | Japan | Asia | Yūko Satō Tanaka; Ryōta Suzuki | Romanized Japanese given names; macrons mark long vowels. | [1](https://www.behindthename.com/name/yu23ko), [2](https://www.behindthename.com/name/ryo23ta) |
| 23–24 | Egypt | Africa | Īmān Hassan; Maḥmūd Mansour | Scholarly Arabic renderings. Iman is conventionally feminine in Arabic and can be masculine in other cultures. | [1](https://www.behindthename.com/name/iman), [2](https://www.behindthename.com/names/usage/arabic) |
| 25–26 | Philippines | Asia | Angélica Reyes; José Cruz Mendoza | Spanish heritage spellings of Angelica and Jose; modern Philippine records often omit the accents. | [1](https://www.behindthename.com/names/usage/spanish), [2](https://forebears.io/philippines/forenames), [3](https://en.wikipedia.org/wiki/Angelica_Panganiban) |
| 27–28 | Democratic Republic of the Congo | Africa | Hélène Ilunga Kabeya; François Mbuyi | Francophone given-name tradition used in DR Congo; country association is illustrative, not an assertion of national rank. | [1](https://www.behindthename.com/names/usage/french) |
| 29–30 | Vietnam | Asia | Hương Nguyễn Trần; Đức Phạm Lê | Vietnamese orthography, including horned vowels and crossed D. | [1](https://www.behindthename.com/names/usage/vietnamese) |
| 31–32 | Iran | Asia | Šīrīn Ahmadi; Ḥossein Hosseini Rahimi | Scholarly Persian renderings of Shirin and Hossein; simplified replacement is visual, not a pronunciation-preserving transliteration. | [1](https://www.behindthename.com/name/shirin), [2](https://www.behindthename.com/name/hossein) |
| 33–34 | Turkey | Asia / Europe | Ayşe Yılmaz Şahin; İbrahim Demir | Turkish letters: cedilla s and uppercase dotted I. | [1](https://www.behindthename.com/names/usage/turkish), [2](https://www.ijoeec.com/Makaleler/1199062239_11.%202641-2670%20%C5%9Feyda%20ye%C5%9Filyurt.pdf) |
| 35–36 | Germany | Europe | Käthe Müller Schmidt; Jürgen Schneider | German umlauts are deliberately simplified as additional test cases. | [1](https://www.behindthename.com/names/usage/german) |
| 37–38 | France | Europe | Élodie Lefèvre; Benoît Dubois Bernard | French accent-bearing given names. | [1](https://www.behindthename.com/names/usage/french) |
| 39–40 | Poland | Europe | Małgorzata Kowalska; Łukasz Nowak Zieliński | Polish crossed L; visual replacement l/L is not the Polish pronunciation. | [1](https://www.behindthename.com/names/usage/polish) |
| 41–42 | Spain | Europe | Lucía García; Íñigo Muñoz Gómez | Spanish accent and tilde-bearing given names. | [1](https://www.behindthename.com/names/usage/spanish) |
| 43–44 | Colombia | South America | Mónica Rodríguez González; Andrés Martínez | Spanish given names used in Colombia. | [1](https://www.behindthename.com/names/usage/spanish) |
| 45–46 | New Zealand | Oceania | Māia Rangi; Nīkau Morgan Thompson | Both appear in the official 2025–2026 Māori baby-name rankings, grouped with spelling variants. | [1](https://www.dia.govt.nz/press.nsf/d77da9b523f12931cc256ac5000d19b6/f07609fb62889341cc258e310039e07a%21OpenDocument) |
| 47–48 | Sweden | Europe | Åsa Andersson Lindström; Björn Johansson | Swedish ring and diaeresis-bearing given names. | [1](https://www.behindthename.com/name/a17sa), [2](https://www.behindthename.com/name/bjo12rn) |
| 49–50 | Ethiopia | Africa | Mäsärät Bekele Alemu; Täsfaye Abebe | Scholarly Amharic renderings of Meseret and Tesfaye. Meseret can be unisex; this row uses its established female usage. | [1](https://nai.uu.se/download/18.39fca04516faedec8b24903b/1580830940484/ORTMAA.pdf), [2](https://www.behindthename.com/name/tesfaye), [3](https://www.scribd.com/document/741587730/AmharicOfficialLawson6-12-13), [4](https://en.wikipedia.org/wiki/Meseret) |

## Using this fixture

`npm run pool:generate` reads this CSV and creates 50 complete applicant profiles (`A-041`–`A-090`) alongside the original 40. Thirty-one profiles have one document using the `german_alphabet_variant` spelling; these accent-only differences should match the applicant's name. Examples: A-077 has “Elodie Lefevre” on all three income proofs, and A-066 has “Jose Cruz Mendoza” on the Mietschuldenfreiheitsbescheinigung. Fifteen other profiles have exactly one document whose name uses the deliberately lossy `special_characters_removed` value, spread across SCHUFA, income proof and previous-landlord documents. Five additional files (`A-091`–`A-095`) duplicate selected CSV profiles with the `german_alphabet_variant` spelling; the applicant facts and submitted documents stay the same apart from the spelling and required unique application ID.

The original 40 include accent-marked applicant names where a seeded selection of document names replaces marked letters with their unaccented base letter. These cases should match without a clarification. Every applicant's name stays consistent across all payslips in their income-proof section. Name spelling differences remain neutral to Credibility; the generated destructive mismatches exercise the clarification flow rather than lowering the score. The CSV does not assert that heavily truncated names must be accepted as matches. In particular, Li-like short names and deletion results of one character are intentional stress cases.

A matching feature also needs separate negative pairs and native-script tests. This fixture covers Latin letters and romanizations only; it does not test Chinese characters, Arabic script, Devanagari or Cyrillic directly. To test Unicode canonical equivalence, derive an NFD copy of column 1 in the test harness while retaining this NFC fixture.

Validation completed: 50 rows, 4 columns, 25 female / 25 male, 50 unique originals, every original contains a special letter, both variants differ from the original and each other, replacement outputs contain only basic German-alphabet letters, no empty fields, NFC originals, and independent CSV parse/round-trip verification.

## Full-name revision

Every row now follows GIVEN NAME + SURNAME, with exactly one given-name word and either one or two surname words. A seeded random shuffle (seed 20260929) assigns 25 one-word and 25 two-word surnames across the 50 rows. The shuffle is independent of gender. Spaces are preserved in both variants, and mutations apply to special letters in both the given name and surname. No extra columns were added.

These full-name combinations are synthetic. Surname components were selected to fit the country contexts, but arbitrary two-surname combinations are test constructions, not assertions of each country’s usual naming practice or of these combinations’ prevalence. Given-name-first order is deliberately standardized even where local usage puts the family name first. For Ethiopia, the last-name slot represents patronymic components rather than an inherited family surname. See [Ethiopian naming conventions](https://en.wikipedia.org/wiki/Habesha_naming_conventions) and [Spanish surname conventions](https://www.gov.uk/government/publications/spain-knowledge-base-profile/spain-knowledge-base-profile). The earlier source map supports given-name research; it is not a registry of the invented full identities.

Validation of this revision additionally checks exactly 25 two-word full names and 25 three-word full names, no doubled or trailing spaces, preserved word counts in both variants, and transformations of accented surname letters.

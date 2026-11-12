// Local, rule-based grammar and style checker. Nothing leaves the browser.
// Each rule returns { s, e, msg, sugg[] } spans over a block's plain text.

const RULES = [];
const rule = (id, type, re, fn) => RULES.push({ id, type, re, fn });

const matchCase = (src, out) => (/^[A-Z]/.test(src) ? out.charAt(0).toUpperCase() + out.slice(1) : out);
const whole = (m, msg, ...sugg) => ({ s: m.index, e: m.index + m[0].length, msg, sugg: sugg.map((x) => matchCase(m[0], x)) });
const prevWord = (text, i) => (/([A-Za-z']+)\W*$/.exec(text.slice(Math.max(0, i - 30), i)) || [])[1]?.toLowerCase() || '';
const tokenAround = (text, i) => {
  let a = i, b = i;
  while (a > 0 && !/\s/.test(text[a - 1])) a--;
  while (b < text.length && !/\s/.test(text[b])) b++;
  return text.slice(a, b);
};
const looksLikeAddress = (t) => /[@/\\]|www\.|\.(com|org|net|io|co|uk|edu|gov|html?|js|css|png|jpe?g|pdf|docx?|txt|md)\b/i.test(t);

/* ---- mechanics ---- */
rule('repeat', 'grammar', /\b([A-Za-z']+)(\s+)\1\b/gi, (m) => {
  if (/^(had|that|is|no|bye|ha|so|very|really)$/i.test(m[1]) || (m[1].length < 2 && !/^a$/i.test(m[1]))) return null;
  if (m[2].includes('\n')) return null;
  return { s: m.index, e: m.index + m[0].length, msg: 'Repeated word', sugg: [m[1]] };
});

const AN_CONS = /^(uni(on|que|t|ty|ted|ts|form|versal|verse|versit|corn|fy|fied|lateral|son|sex|cycle)|use[drs]?$|users|using|usual|usage|utilit|utensil|utopia|uter|euro|eulog|euphem|euphor|eucalypt|ewe|one$|once$|one-|ubiquit|ukulele|uranium|urin|unanim|u$)/i;
const A_VOWEL = /^(hour|honest|honou?r|heir|html|http|mba|fbi|sms|xml|x-ray|nhs|nba|mp3|sql|fyi|rsvp|mri|led$|lcd)/i;
rule('article', 'grammar', /\b(a|an)(\s+)([A-Za-z][A-Za-z'-]*)/gi, (m) => {
  const art = m[1], w = m[3];
  if (m[2].includes('\n')) return null;
  if (w.length < 2 || /^(and|or|in|is|of|on|at|as|it|if|are|up|out|to|the|for|but|an)$/i.test(w)) return null;
  if (w.length > 1 && w === w.toUpperCase() && !A_VOWEL.test(w)) return null;
  const vowelSound = A_VOWEL.test(w) || (/^[aeiou]/i.test(w) && !AN_CONS.test(w));
  const want = vowelSound ? 'an' : 'a';
  if (art.toLowerCase() === want) return null;
  return { s: m.index, e: m.index + art.length, msg: `Use “${want}” before “${w}”`, sugg: [matchCase(art, want)] };
});

rule('capital', 'grammar', /(^|[.!?]["”’)]?[ \t]+)([a-z])([A-Za-z'’]*)/g, (m, text) => {
  const at = m.index + m[1].length;
  const word = m[2] + m[3];
  if (/[A-Z]/.test(m[3])) return null;                       // iPhone, eBay
  if (looksLikeAddress(tokenAround(text, at))) return null;
  if (m[1] === '') {
    if (text.trim().split(/\s+/).length < 4) return null;    // labels, table cells
  } else {
    const before = text.slice(Math.max(0, m.index - 12), m.index + 1);
    if (/\.\.\.?$/.test(before) && /\.\./.test(before)) return null;
    if (/(?:^|[\s(])(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|st|no|approx|inc|ltd|fig|cf|al|[A-Za-z])\.$/i.test(before)) return null;
  }
  return { s: at, e: at + word.length, msg: 'Start the sentence with a capital letter', sugg: [word.charAt(0).toUpperCase() + word.slice(1)] };
});

rule('pronoun-i', 'grammar', /(?<![\w.'’-])i(?=(?:['’](?:m|ve|ll|d))?(?:[\s,;:!?]|$))/g, (m) => ({ s: m.index, e: m.index + 1, msg: 'The pronoun “I” is always capitalised', sugg: ['I'] }));

rule('spaces', 'grammar', /(?<=\S) {2,}(?=\S)/g, (m) => ({ s: m.index, e: m.index + m[0].length, msg: 'Extra space between words', sugg: [' '] }));

rule('space-before', 'grammar', /(?<=[A-Za-z0-9]) +([,;!?]|\.(?![\w.]))/g, (m) => ({ s: m.index, e: m.index + m[0].length, msg: 'Remove the space before the punctuation mark', sugg: [m[1]] }));

rule('space-after', 'grammar', /([a-z]{2,})([,;!?])([A-Za-z]{2,})/g, (m, text) => {
  if (looksLikeAddress(tokenAround(text, m.index))) return null;
  return { s: m.index, e: m.index + m[0].length, msg: 'Add a space after the punctuation mark', sugg: [`${m[1]}${m[2]} ${m[3]}`] };
});
rule('space-after-stop', 'grammar', /([a-z]{2,})\.([A-Z][a-z]+)/g, (m, text) => {
  if (looksLikeAddress(tokenAround(text, m.index))) return null;
  return { s: m.index, e: m.index + m[0].length, msg: 'Add a space after the full stop', sugg: [`${m[1]}. ${m[2]}`] };
});

rule('double-punct', 'grammar', /([,;:])\1+/g, (m) => ({ s: m.index, e: m.index + m[0].length, msg: 'Repeated punctuation', sugg: [m[1]] }));
rule('double-stop', 'grammar', /(?<![.\w]\.|\.)\.\.(?!\.)/g, (m) => ({ s: m.index, e: m.index + 2, msg: 'Two full stops', sugg: ['.', '…'] }));

/* ---- commonly confused words ---- */
rule('of-have', 'grammar', /\b(could|should|would|must|might)(n't)?\s+of\b/gi, (m) => whole(m, 'Use “have” after a modal verb, not “of”', `${m[1]}${m[2] || ''} have`));
rule('their-there', 'grammar', /\btheir\s+(is|are|was|were|isn't|aren't|wasn't)\b/gi, (m) => whole(m, '“There” is the word for existence; “their” shows possession', `there ${m[1]}`));
rule('your-youre', 'grammar', /\byour\s+(welcome|going to|not|a|an|the best|so|right about)\b/gi, (m) => whole(m, '“You’re” is short for “you are”', `you're ${m[1]}`));
rule('its-its', 'grammar', /\bits\s+(a|an|not|been|going|really|been)\b/gi, (m) => whole(m, '“It’s” is short for “it is” or “it has”', `it's ${m[1]}`));
rule('then-than', 'grammar', /\b(better|worse|more|less|rather|other|greater|fewer|bigger|smaller|higher|lower|older|younger|faster|slower|easier|harder|longer|shorter|larger)\s+then\b/gi, (m) => whole(m, 'Use “than” for comparisons', `${m[1]} than`));
rule('to-too', 'grammar', /\b(is|are|was|were|way|far|it's|that's|am|be|been|got|getting|just|not)\s+to\s+(much|many|few|late|early|often|soon|big|small|hard|easy|long|short|fast|slow|hot|cold|good|bad)\b(?!\s+(?:people|of|more|things|others))/gi,
  (m) => { const at = m.index + m[0].toLowerCase().indexOf(' to ') + 1; return { s: at, e: at + 2, msg: '“Too” means “excessively”', sugg: ['too'] }; });
rule('supposed-to', 'grammar', /\b(am|is|are|was|were|i'm|you're|we're|they're|he's|she's|it's)\s+suppose\s+to\b/gi, (m) => whole(m, 'Use “supposed to”', `${m[1]} supposed to`));
rule('used-to', 'grammar', /\b(i|you|he|she|we|they|it|there)\s+use\s+to\b/gi, (m) => whole(m, 'Use “used to” for past habits', `${m[1]} used to`));
rule('intents', 'grammar', /\bfor all intensive purposes\b/gi, (m) => whole(m, 'The phrase is “for all intents and purposes”', 'for all intents and purposes'));
rule('irregardless', 'grammar', /\birregardless\b/gi, (m) => whole(m, 'Use “regardless”', 'regardless'));
rule('alot', 'grammar', /\balot\b/gi, (m) => whole(m, '“A lot” is two words', 'a lot'));

const CONTRACTIONS = { dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", wont: "won't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't", shouldnt: "shouldn't", couldnt: "couldn't", wouldnt: "wouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", im: "I'm", ive: "I've", youre: "you're", theyre: "they're", thats: "that's", whats: "what's", theres: "there's", youve: "you've", weve: "we've" };
rule('apostrophe', 'grammar', new RegExp(`\\b(${Object.keys(CONTRACTIONS).join('|')})\\b`, 'gi'), (m) => {
  if (m[0] === m[0].toUpperCase() && m[0].length > 1) return null; // IM, IVE as acronyms
  const fix = CONTRACTIONS[m[0].toLowerCase()];
  return { s: m.index, e: m.index + m[0].length, msg: 'Missing apostrophe', sugg: [fix.startsWith('I') ? fix : matchCase(m[0], fix)] };
});

/* ---- agreement ---- */
const BASE = { went: 'go', saw: 'see', came: 'come', took: 'take', gave: 'give', knew: 'know', ate: 'eat', ran: 'run', wrote: 'write', said: 'say', made: 'make', got: 'get', had: 'have', did: 'do', told: 'tell', found: 'find', thought: 'think', left: 'leave', bought: 'buy' };
rule('did-base', 'grammar', new RegExp(`\\b(didn't|did not|doesn't|don't)\\s+(${Object.keys(BASE).join('|')})\\b`, 'gi'), (m) => whole(m, 'Use the base form of the verb after “do”', `${m[1]} ${BASE[m[2].toLowerCase()]}`));
rule('he-dont', 'grammar', /\b(he|she|it)\s+don't\b/gi, (m) => whole(m, 'Subject and verb do not agree', `${m[1]} doesn't`));
rule('they-was', 'grammar', /\b(they|we|you)\s+was(n't)?\b/gi, (m) => whole(m, 'Subject and verb do not agree', `${m[1]} were${m[2] || ''}`));
const AUX = /^(did|does|do|can|could|would|should|will|shall|may|might|must|let|lets|make|makes|made|help|helps|see|saw|watch|and|or|nor|to|than|if)$/;
rule('he-have', 'grammar', /\b(he|she)\s+(have|are)\b/gi, (m, text) => {
  if (AUX.test(prevWord(text, m.index))) return null;
  return whole(m, 'Subject and verb do not agree', `${m[1]} ${m[2].toLowerCase() === 'have' ? 'has' : 'is'}`);
});
rule('i-has', 'grammar', /\b(I|we|they|you)\s+(has|does|doesn't|is)\b/g, (m, text) => {
  if (/^(and|or|nor|than|of|with|to|for)$/.test(prevWord(text, m.index)) && m[1] !== 'I') return null;
  const v = m[2].toLowerCase();
  const fix = v === 'has' ? 'have' : v === 'does' ? 'do' : v === "doesn't" ? "don't" : (m[1] === 'I' ? 'am' : 'are');
  return { s: m.index, e: m.index + m[0].length, msg: 'Subject and verb do not agree', sugg: [`${m[1]} ${fix}`] };
});
const COMP = 'better|worse|bigger|smaller|faster|slower|easier|harder|taller|shorter|older|younger|stronger|weaker|cheaper|nicer|smarter|happier|simpler|larger|higher|lower|quicker|safer|cleaner|closer';
rule('double-comp', 'grammar', new RegExp(`\\bmore\\s+(${COMP})\\b`, 'gi'), (m) => whole(m, 'Double comparative', m[1]));
rule('double-sup', 'grammar', /\bmost\s+(best|worst|biggest|smallest|fastest|slowest|easiest|hardest|tallest|oldest|youngest|strongest|cheapest|nicest|smartest|happiest|simplest|largest|highest|lowest)\b/gi, (m) => whole(m, 'Double superlative', m[1]));
rule('less-fewer', 'grammar', /\bless\s+(people|items|things|cars|students|problems|errors|mistakes|words|pages|users|customers|days|hours|options)\b/gi, (m) => whole(m, 'Use “fewer” with things you can count', `fewer ${m[1]}`));

/* ---- style and concision ---- */
const WORDY = [
  ['in order to', 'to'], ['due to the fact that', 'because'], ['in spite of the fact that', 'although'],
  ['at this point in time', 'now'], ['at the present time', 'now'], ['in the event that', 'if'],
  ['a large number of', 'many'], ['the majority of', 'most'], ['has the ability to', 'can'],
  ['have the ability to', 'can'], ['is able to', 'can'], ['are able to', 'can'],
  ['each and every', 'each', 'every'], ['end result', 'result'], ['free gift', 'gift'],
  ['past history', 'history'], ['advance planning', 'planning'], ['absolutely essential', 'essential'],
  ['very unique', 'unique'], ['completely unique', 'unique'], ['with regard to', 'about'],
  ['with regards to', 'about'], ['in regards to', 'about'], ['for the purpose of', 'for', 'to'],
  ['in close proximity to', 'near'], ['on a daily basis', 'daily'], ['on a regular basis', 'regularly'],
  ['the reason is because', 'the reason is that'], ['first and foremost', 'first'],
  ['in the near future', 'soon'], ['a number of', 'several', 'some'], ['prior to', 'before'],
  ['subsequent to', 'after'], ['at all times', 'always'], ['in the event of', 'if'],
  ['despite the fact that', 'although'], ['owing to the fact that', 'because'], ['in a timely manner', 'promptly', 'on time'],
  ['take into consideration', 'consider'], ['make a decision', 'decide'], ['come to a conclusion', 'conclude'],
  ['give consideration to', 'consider'], ['until such time as', 'until'], ['with the exception of', 'except for'],
  ['in the vicinity of', 'near'], ['whether or not', 'whether'], ['as to whether', 'whether'], ['for the most part', 'mostly'],
  ['final outcome', 'outcome'], ['future plans', 'plans'], ['unexpected surprise', 'surprise'], ['revert back', 'revert'],
  ['return back', 'return'], ['repeat again', 'repeat'], ['join together', 'join'], ['basic fundamentals', 'fundamentals'],
  ['added bonus', 'bonus'], ['exact same', 'same'], ['ATM machine', 'ATM'], ['PIN number', 'PIN'],
  ['off of', 'off'], ['try and', 'try to'], ['anyways', 'anyway'], ['utilize', 'use'], ['utilise', 'use'], ['utilizes', 'uses'], ['utilises', 'uses'],
];
for (const [phrase, ...alts] of WORDY) {
  rule('wordy:' + phrase, 'style', new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'gi'), (m) => whole(m, 'This can be said more simply', ...alts));
}
rule('can-not', 'style', /\bcan\s+not\b(?!\s+only)/gi, (m) => whole(m, 'Usually written as one word', 'cannot'));

/* ---- commonly confused words ---- */
rule('whos-whose', 'grammar', /\bwho['’]s\s+(book|car|house|turn|fault|idea|name|job|phone|responsibility|side|work|life|father|mother|parents|children|family)\b/gi, (m) => ({ s: m.index, e: m.index + 5, msg: 'Use “whose” to show ownership', sugg: [matchCase(m[0], 'whose')] }));
rule('whose-whos', 'grammar', /\bwhose\s+(going|coming|been|there|here|ready|next|responsible|in charge)\b/gi, (m) => ({ s: m.index, e: m.index + 5, msg: 'Use “who’s” for “who is” or “who has”', sugg: [matchCase(m[0], 'who’s')] }));
rule('affect-noun', 'grammar', /\b(the|an|no|any|side|positive|negative|little|big|huge|major|lasting|same|opposite)\s+affects?\b(?!\s+(the|my|your|our|their|his|her|its|me|us|you|them|how)\b)/gi, (m) => {
  const w = /affects?$/i.exec(m[0])[0];
  return { s: m.index + m[0].length - w.length, e: m.index + m[0].length, msg: 'The noun is “effect”', sugg: [w.replace(/^a/i, 'e')] };
});
rule('effect-verb', 'grammar', /\b(will|would|can|could|may|might|to|not|doesn't|didn't|won't|don't)\s+effect\s+(the|my|your|our|their|his|her|its|how|what|us|me|you|them|everyone)\b/gi, (m) => {
  const at = m.index + m[1].length + m[0].slice(m[1].length).indexOf('effect');
  return { s: at, e: at + 6, msg: 'The verb is usually “affect”', sugg: ['affect'] };
});
rule('loose-lose', 'grammar', /\b(to|will|would|might|could|can|may|don't|didn't|won't|not|never)\s+loose\b(?!\s+(ends?|change|cannon|fit|fitting)\b)/gi, (m) => ({ s: m.index + m[0].length - 5, e: m.index + m[0].length, msg: '“Lose” means to misplace or not win', sugg: ['lose'] }));
rule('loose-lose2', 'grammar', /\bloos(e|ing)\s+(weight|money|track|sight|interest|hope|control|touch|time|faith|patience|focus)\b/gi, (m) => whole(m, '“Lose” means to misplace or not win', `los${m[1].toLowerCase() === 'e' ? 'e' : 'ing'} ${m[2]}`));
rule('accept-except', 'grammar', /\bexcept\s+(the|this|that|your|my|our|his|her|their|an|full)\s+(offer|invitation|apology|terms|job|award|responsibility|challenge|payment|proposal|gift)\b/gi, (m) => ({ s: m.index, e: m.index + 6, msg: '“Accept” means to receive or agree to', sugg: [matchCase(m[0], 'accept')] }));
rule('advise-noun', 'grammar', /\b(my|your|his|her|their|our|some|any|good|bad|great|this|that|legal|medical|financial)\s+advise\b/gi, (m) => ({ s: m.index + m[0].length - 6, e: m.index + m[0].length, msg: 'The noun is “advice”', sugg: ['advice'] }));
rule('advice-verb', 'grammar', /\b(to|will|would|can|could|should|please|I|we|they)\s+advice\s+(you|him|her|them|us|me|that|against)\b/g, (m) => {
  const at = m.index + m[0].indexOf('advice');
  return { s: at, e: at + 6, msg: 'The verb is “advise”', sugg: ['advise'] };
});
rule('weather-whether', 'grammar', /\bweather\s+(or\s+not|you|he|she|we|they|I|it|to)\b/gi, (m) => ({ s: m.index, e: m.index + 7, msg: 'Use “whether” for a choice or doubt', sugg: [matchCase(m[0], 'whether')] }));
rule('its-apos', 'grammar', /\bits['’](?![A-Za-z])/gi, (m) => whole(m, '“Its’” is not a word', 'its', 'it’s'));
const EGGCORNS = [
  ['sneak peak', 'sneak peek'], ['peaked my interest', 'piqued my interest'], ['peaked my curiosity', 'piqued my curiosity'],
  ['could care less', 'couldn’t care less'], ['per say', 'per se'], ['bare with me', 'bear with me'],
  ['one in the same', 'one and the same'], ['case and point', 'case in point'], ['baited breath', 'bated breath'],
  ['tow the line', 'toe the line'], ['nip it in the butt', 'nip it in the bud'], ['mute point', 'moot point'],
  ['escape goat', 'scapegoat'], ['by in large', 'by and large'], ['wreck havoc', 'wreak havoc'],
  ['free reign', 'free rein'], ['slight of hand', 'sleight of hand'], ['deep seeded', 'deep-seated'],
  ['do diligence', 'due diligence'], ['extract revenge', 'exact revenge'], ['supposably', 'supposedly'],
  ['comprised of', 'composed of', 'made up of'], ['between you and I', 'between you and me'],
  ['aswell', 'as well'], ['infact', 'in fact'], ['incase', 'in case'], ['atleast', 'at least'], ['eachother', 'each other'],
  ['noone', 'no one'], ['everytime', 'every time'], ['thankyou', 'thank you'], ['and etc', 'etc'], ['ect', 'etc'],
];
for (const [phrase, ...alts] of EGGCORNS) {
  rule('phrase:' + phrase, 'grammar', new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}\\b`, 'gi'), (m) => whole(m, 'Commonly confused phrase', ...alts));
}
rule('everyday', 'grammar', /\b(an|my|your|our|their|the|for)\s+every\s+day\s+(life|use|task|tasks|items|objects|routine|language|clothes|activities|problems|things)\b/gi, (m) => {
  const at = m.index + m[1].length + m[0].slice(m[1].length).search(/every/i);
  const len = /every\s+day/i.exec(m[0])[0].length;
  return { s: at, e: at + len, msg: 'As an adjective, “everyday” is one word', sugg: ['everyday'] };
});

/* ---- verbs and agreement ---- */
const PARTICIPLE = { went: 'gone', ate: 'eaten', saw: 'seen', did: 'done', came: 'come', took: 'taken', wrote: 'written', drove: 'driven', spoke: 'spoken', broke: 'broken', chose: 'chosen', gave: 'given', ran: 'run', began: 'begun', drank: 'drunk', sang: 'sung', swam: 'swum', knew: 'known', grew: 'grown', threw: 'thrown', flew: 'flown', forgot: 'forgotten', fell: 'fallen', rode: 'ridden', wore: 'worn', tore: 'torn', stole: 'stolen', froze: 'frozen', became: 'become', shook: 'shaken' };
rule('have-past', 'grammar', new RegExp(`\\b(have|has|had|having|[A-Za-z]+['’]ve)\\s+((?:not|never|already|just|also)\\s+)?(${Object.keys(PARTICIPLE).join('|')})\\b`, 'gi'), (m) => {
  const w = m[3];
  return { s: m.index + m[0].length - w.length, e: m.index + m[0].length, msg: `After “${m[1].toLowerCase()}”, use “${PARTICIPLE[w.toLowerCase()]}”`, sugg: [PARTICIPLE[w.toLowerCase()]] };
});
const HAVE_PREV = /^(have|has|had|having|be|been|being|is|are|was|were|am|get|gets|got|and|or)$|['’](ve|d|s|re)$/;
rule('seen-done', 'grammar', /\b(I|we|they|he|she)\s+(seen|done|gone)\b/g, (m, text) => {
  if (HAVE_PREV.test(prevWord(text, m.index))) return null;
  const fix = { seen: 'saw', done: 'did', gone: 'went' }[m[2]];
  return { s: m.index + m[0].length - m[2].length, e: m.index + m[0].length, msg: `Use “${fix}”, or add “have” before “${m[2]}”`, sugg: [fix, `have ${m[2]}`] };
});
rule('i-doesnt', 'grammar', /\b(I|we|they|you)\s+doesn['’]t\b/gi, (m) => whole(m, 'Subject and verb do not agree', `${m[1]} don’t`));
rule('there-is-many', 'grammar', /\bthere(\s+is|['’]s|\s+was)\s+(many|several|two|three|four|five|multiple|numerous|a\s+few|a\s+couple\s+of|lots\s+of)\b/gi, (m) => {
  const verb = /was/i.test(m[1]) ? 'were' : 'are';
  return { s: m.index, e: m.index + 5 + m[1].length, msg: 'Use a plural verb with a plural subject', sugg: [matchCase(m[0], `there ${verb}`)] };
});
rule('everyone-are', 'grammar', /\b(everyone|everybody|someone|somebody|anyone|anybody|nobody|no one|each of (?:them|us|you))\s+(are|were|have)\b/gi, (m, text) => {
  if (AUX.test(prevWord(text, m.index))) return null;
  const fix = { are: 'is', were: 'was', have: 'has' }[m[2].toLowerCase()];
  return { s: m.index + m[0].length - m[2].length, e: m.index + m[0].length, msg: `“${m[1]}” takes a singular verb`, sugg: [fix] };
});
rule('these-kind', 'grammar', /\b(these|those)\s+(kind|type|sort)\s+of\b/gi, (m) => whole(m, 'The number does not match', `${m[1].toLowerCase() === 'these' ? 'this' : 'that'} ${m[2]} of`, `${m[1]} ${m[2]}s of`));
const COUNT = 'people|items|things|cars|students|problems|errors|mistakes|words|pages|users|customers|days|hours|options|books|friends|questions|ideas|times|files|emails|jobs|houses|children';
rule('much-many', 'grammar', new RegExp(`\\b(too|so|how|as|not)?\\s*much\\s+(${COUNT})\\b`, 'gi'), (m) => {
  const at = m.index + m[0].search(/much/i);
  return { s: at, e: at + 4, msg: 'Use “many” with things you can count', sugg: [matchCase(m[0].slice(at - m.index), 'many')] };
});
rule('amount-number', 'grammar', new RegExp(`\\bamount\\s+of\\s+(${COUNT})\\b`, 'gi'), (m) => ({ s: m.index, e: m.index + 6, msg: 'Use “number” with things you can count', sugg: [matchCase(m[0], 'number')] }));
const NEG_FIX = { nothing: 'anything', nobody: 'anybody', nowhere: 'anywhere', 'no one': 'anyone', none: 'any' };
rule('double-negative', 'grammar', /\b(don['’]t|doesn['’]t|didn['’]t|can['’]t|couldn['’]t|won['’]t|wouldn['’]t|haven['’]t|hasn['’]t|isn['’]t|aren['’]t|ain['’]t|never)\s+([a-z]+\s+)?(nothing|nobody|nowhere|no one|none)\b/gi, (m) => {
  const w = m[3];
  return { s: m.index + m[0].length - w.length, e: m.index + m[0].length, msg: 'Double negative', sugg: [NEG_FIX[w.toLowerCase()]] };
});
rule('me-and', 'grammar', /(^|[.!?]\s+)Me\s+and\s+(my\s+[a-z]+|[A-Z][a-z]+|him|her|them)\b/g, (m) => {
  const s = m.index + m[1].length;
  const other = m[2].replace(/^him$/, 'he').replace(/^her$/, 'she').replace(/^them$/, 'they');
  return { s, e: m.index + m[0].length, msg: 'Use “I” as the subject, and put yourself last', sugg: [`${other.charAt(0).toUpperCase() + other.slice(1)} and I`] };
});
rule('to-who', 'style', /\b(to|with|for|from)\s+who\b(?!\s+(is|was|are|were|has|had)\b)/gi, (m) => ({ s: m.index + m[0].length - 3, e: m.index + m[0].length, msg: 'In formal writing, use “whom” after a preposition', sugg: ['whom'] }));

/* ---- punctuation and capitals ---- */
rule('intro-comma', 'grammar', /(^|[.!?]\s+)(However|Therefore|Moreover|Furthermore|Nevertheless|Consequently|Unfortunately|Fortunately|Additionally|Meanwhile|For example|For instance|In addition|In conclusion|In fact|On the other hand|As a result|First of all)\s+(?=[A-Za-z])(?!(much|many|long|hard|you|we|it|they|he|she|I)\b)/g, (m) => {
  const s = m.index + m[1].length;
  return { s, e: s + m[2].length, msg: 'Add a comma after an introductory phrase', sugg: [m[2] + ','] };
});
rule('question-mark', 'grammar', /(^|[.!?]\s+)(Do|Does|Did|Can|Could|Would|Will|Are|Is)\s+(you|we|they|I|he|she|it|there)\s[^.!?,;:\n]*(\.)(?=\s|$)/g, (m) => {
  const at = m.index + m[0].length - 1;
  return { s: at, e: at + 1, msg: 'This reads as a question', sugg: ['?'] };
});
rule('day-month', 'grammar', /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|september|october|november|december)\b/g, (m, text) => {
  if (looksLikeAddress(tokenAround(text, m.index))) return null;
  return { s: m.index, e: m.index + m[0].length, msg: 'Days and months start with a capital letter', sugg: [m[0].charAt(0).toUpperCase() + m[0].slice(1)] };
});

/* ---- clarity ---- */
rule('passive', 'style', /\b(is|are|was|were|be|been|being)\s+([a-z]+ed|written|taken|given|made|done|seen|known|shown|built|sent|held|found|told|kept|left|paid|sold|chosen|broken)\s+by\b/gi, (m) => whole(m, 'Passive voice. Consider naming who did it first.'));
const STRONGER = { big: ['huge', 'enormous'], small: ['tiny'], tired: ['exhausted'], important: ['crucial', 'essential'], good: ['excellent', 'great'], bad: ['terrible', 'awful'], happy: ['delighted', 'thrilled'], sad: ['miserable'], angry: ['furious'], hungry: ['starving'], cold: ['freezing'], hot: ['scorching'], scared: ['terrified'], funny: ['hilarious'], smart: ['brilliant'], tasty: ['delicious'], dirty: ['filthy'], clean: ['spotless'], old: ['ancient'], pretty: ['beautiful'] };
rule('very', 'style', new RegExp(`\\b(very|really)\\s+(${Object.keys(STRONGER).join('|')})\\b`, 'gi'), (m) => whole(m, 'A stronger word may work better', ...STRONGER[m[2].toLowerCase()]));

export function checkGrammar(text) {
  const out = [];
  if (!text || !/\S/.test(text)) return out;
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(text))) {
      if (m[0] === '') { r.re.lastIndex++; continue; }
      const hit = r.fn(m, text);
      if (hit && hit.e > hit.s) out.push({ ...hit, type: r.type, rule: r.id });
    }
  }
  // Drop overlaps, keeping the earliest and longest finding.
  out.sort((a, b) => a.s - b.s || b.e - a.e);
  const kept = [];
  for (const h of out) if (!kept.length || h.s >= kept[kept.length - 1].e) kept.push(h);
  return kept;
}

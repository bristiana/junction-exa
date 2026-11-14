"""Which language an errand is written in: script first, then common words and letters. No network, no model."""
import re

NAMES = {'en': 'English', 'fi': 'Finnish', 'sv': 'Swedish', 'et': 'Estonian', 'ro': 'Romanian', 'uk': 'Ukrainian',
         'ru': 'Russian', 'de': 'German', 'fr': 'French', 'es': 'Spanish', 'pt': 'Portuguese', 'it': 'Italian',
         'pl': 'Polish', 'nl': 'Dutch', 'tr': 'Turkish', 'ar': 'Arabic', 'fa': 'Persian', 'he': 'Hebrew',
         'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean', 'hi': 'Hindi', 'th': 'Thai', 'vi': 'Vietnamese'}
_SCRIPTS = [('ja', r'[぀-ヿ]'), ('ko', r'[가-힯]'), ('zh', r'[一-鿿]'), ('he', r'[֐-׿]'),
            ('fa', r'[پچژگ]'), ('ar', r'[؀-ۿ]'), ('hi', r'[ऀ-ॿ]'), ('th', r'[฀-๿]'),
            ('uk', r'[іїєґІЇЄҐ]'), ('ru', r'[Ѐ-ӿ]')]
_LETTERS = {'ro': 'ăâîșşțţ', 'sv': 'å', 'et': 'õ', 'de': 'ß', 'es': 'ñ¿¡', 'pt': 'ãõç', 'fr': 'èêçœ', 'pl': 'ąęłńśźż',
            'tr': 'ğış', 'vi': 'ơưđạả'}
_WORDS = {
    'en': 'the how what where when which is are a an for my me do does can could to of in with and or i\'m need want '
          'find book claim write check help get much'.split(),
    'fi': 'mitä miten kuinka paljon missä milloin mikä onko voinko saako on ei ja tai minun minä mä mun pitää '
          'tarvitsen haluan voin saan maksaa kanssa varaa hae etsi ajanvaraus terveysasema vuokra asunto opintotuki '
          'kuukausilippu verokortti muuttoilmoitus hakemus lääkäri hammaslääkäri opiskelijalle paljonko mistä mihin '
          'halvin halvempi edullisin paras lähin vertailu hinta hinnat sähkö sähkösopimus sopimus juna junalippu lippu '
          'vero verot tulot tuki tulorajat kunta muutto ilmoittautuminen jos kun voi'.split(),
    'sv': 'och jag är att det en ett hur vad var när kan min mitt för med på av behöver vill akut tandläkare '
          'hyra bostad'.split(),
    'et': 'kuidas mis kus millal kas on ei ja mina ma saan vaja tahan'.split(),
    'ro': 'și sau cum ce unde când cât câte pot să nu este sunt în la pentru vreau am nevoie de cu mea meu '
          'mele mei unei unui'.split(),
    'de': 'und ich wie was wo wann ist sind der die das nicht ein eine für mit kann brauche möchte meine in'.split(),
    'fr': 'et je comment quoi où quand est sont le la les pour avec un une des mon ma mes puis besoin'.split(),
    'es': 'y cómo qué dónde cuándo es son el la los las para con un una mi mis puedo necesito quiero'.split(),
    'pt': 'como onde quando para com não eu preciso posso uma meu minha'.split(),
    'it': 'come cosa dove quando il lo gli per con sono posso ho bisogno voglio mio mia quanto quanta costa '
          'treno biglietto prezzo di del della da che qual quale in'.split(),
    'pl': 'jak gdzie co kiedy czy jest nie dla mogę potrzebuję chcę mój moja'.split(),
    'nl': 'hoe wat waar wanneer ik me mij het een voor met niet is mijn kan nodig moet wil na van de op bij naar '
          'zijn hoeveel welke waarom schrijf inschrijven verhuizing verhuisd gemeente aanvragen goedkoopste kost in'.split(),
    'tr': 'nasıl nerede ne zaman bir için ve ben benim lazım istiyorum'.split(),
}
_SHARED = {}
for _vocabulary in _WORDS.values():
    for _word in set(_vocabulary):
        _SHARED[_word] = _SHARED.get(_word, 0) + 1
_UKRAINIAN = set('як що чи мені мій моя можна скільки потрібно отримати де'.split())  # not Russian words
_URL = re.compile(r'https?://\S+')


def detect(text):
    """ISO 639-1 code, or None when the text gives no evidence (one-word errands such as "Kela" or "sauna")."""
    text = _URL.sub(' ', str(text or ''))
    for code, pattern in _SCRIPTS:
        if len(re.findall(pattern, text)) >= (1 if code == 'uk' else 2):  # one і/ї/є/ґ already rules out Russian
            return 'uk' if code == 'ru' and _UKRAINIAN & set(re.findall(r'\w+', text.lower())) else code
    lowered = text.lower()
    words = re.findall(r"[\w']+", lowered)
    # A word several languages share ("in", "me", "de") is split between them, so it cannot outvote a distinct one.
    scores = {code: sum(1 / _SHARED[w] for w in words if w in vocabulary) for code, vocabulary in _WORDS.items()}
    for code, letters in _LETTERS.items():
        scores[code] = scores.get(code, 0) + 2 * sum(ch in lowered for ch in letters)
    scores['nl'] += sum('ij' in w for w in words)  # "schrijf", "mijn", "tijd": a Dutch spelling English lacks
    scores['fi'] += 0.5 * any(ch in lowered for ch in 'äö')  # weak: a Finnish compound has no common word to match
    ranked = sorted(scores.values(), reverse=True)
    best = max(scores, key=scores.get)
    return best if ranked[0] > ranked[1] else None  # a tie is no evidence


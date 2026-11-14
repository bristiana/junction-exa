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
          'kuukausilippu verokortti muuttoilmoitus hakemus lääkäri hammaslääkäri opiskelijalle'.split(),
    'sv': 'och jag är att det en ett hur vad var när kan min mitt för med på av behöver vill akut tandläkare '
          'hyra bostad'.split(),
    'et': 'kuidas mis kus millal kas on ei ja mina ma saan vaja tahan'.split(),
    'ro': 'și sau cum ce unde când cât câte pot să nu este sunt în la pentru vreau am nevoie de cu mea meu '
          'mele mei unei unui'.split(),
    'de': 'und ich wie was wo wann ist sind der die das nicht ein eine für mit kann brauche möchte meine'.split(),
    'fr': 'et je comment quoi où quand est sont le la les pour avec un une des mon ma mes puis besoin'.split(),
    'es': 'y cómo qué dónde cuándo es son el la los las para con un una mi mis puedo necesito quiero'.split(),
    'pt': 'como onde quando para com não eu preciso posso uma meu minha'.split(),
    'it': 'come cosa dove quando il per con sono posso ho bisogno voglio mio mia'.split(),
    'pl': 'jak gdzie co kiedy czy jest nie dla mogę potrzebuję chcę mój moja'.split(),
    'nl': 'hoe wat waar wanneer ik het een voor met niet is mijn kan nodig'.split(),
    'tr': 'nasıl nerede ne zaman bir için ve ben benim lazım istiyorum'.split(),
}
_URL = re.compile(r'https?://\S+')


def detect(text):
    """ISO 639-1 code, or None when the text gives no evidence (one-word errands such as "Kela" or "sauna")."""
    text = _URL.sub(' ', str(text or ''))
    for code, pattern in _SCRIPTS:
        if len(re.findall(pattern, text)) >= 2:
            return code
    lowered = text.lower()
    words = re.findall(r"[\w']+", lowered)
    scores = {code: sum(w in vocabulary for w in words) for code, vocabulary in _WORDS.items()}
    for code, letters in _LETTERS.items():
        scores[code] = scores.get(code, 0) + 2 * sum(ch in lowered for ch in letters)
    best = max(scores, key=lambda code: (scores[code], code == 'en'))
    return best if scores[best] > 0 else None


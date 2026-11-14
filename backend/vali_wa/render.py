"""Pure WhatsApp renderers. Every renderer returns a list of message bodies."""

import re
from urllib.parse import urlsplit
import httpx

MAX_MESSAGE_LENGTH = 4096


def fill_placeholders(value, profile=None):
    profile = profile or {}

    def replace(match):
        key = match[1].lower()
        value = profile.get(key)
        return str(value) if value is not None and str(value).strip() else f"‹{key}›"

    return re.sub(r"\{\{\s*([a-z_]+)\s*\}\}", replace, str(value or ""), flags=re.I)


def _text(value, profile=None):
    text = fill_placeholders(value, profile)
    text = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r"\1 – \2", text)
    return re.sub(r"\*\*([^*]+)\*\*", r"*\1*", text)


def split_messages(text, limit=MAX_MESSAGE_LENGTH):
    """Split without dropping characters, preferring line boundaries."""
    if limit < 1:
        raise ValueError("limit must be positive")
    messages = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        cut = cut + 1 if cut >= limit // 2 else limit
        messages.append(text[:cut])
        text = text[cut:]
    if text:
        messages.append(text)
    return messages


def _safe_url(value):
    try:
        if not isinstance(value, str) or urlsplit(value.strip()).scheme.lower() not in {"http", "https"}:
            return None
        url = httpx.URL(value.strip())
        if not url.host:
            return None
        # WHATWG URL.href supplies '/' for a bare origin, including before query/fragment.
        if not url.path:
            url = url.copy_with(path="/")
        result = str(url)
        if urlsplit(result).path == "":
            parts = urlsplit(result)
            result = parts._replace(path="/").geturl()
        return result
    except (ValueError, httpx.InvalidURL):
        return None


def _norm_field(field):
    field = re.sub(r"^\$\.?", "", str(field or ""))
    return re.sub(r"\.(\d+)(?=\.|$)", r"[\1]", field)


def number_sources(grounding=None):
    """Mirror extension numberSources: first URL occurrence, last field entry wins."""
    sources, index, by_field = [], {}, {}
    for ground in grounding or []:
        nums = []
        for citation in ground.get("citations") or []:
            url = _safe_url(citation.get("url"))
            if not url:
                continue
            if url not in index:
                n = len(sources) + 1
                index[url] = n
                host = re.sub(r"^www\.", "", urlsplit(url).hostname or "")
                sources.append({"n": n, "url": url, "title": citation.get("title") or host,
                                "host": host})
            if index[url] not in nums:
                nums.append(index[url])
        if nums:
            by_field[_norm_field(ground.get("field"))] = {
                "nums": nums, "confidence": ground.get("confidence") or None}
    return {"sources": sources, "byField": by_field}


def cites_for(by_field, prefix):
    nums, confidence = set(), None
    for field, value in (by_field or {}).items():
        if field == prefix or field.startswith(prefix + ".") or field.startswith(prefix + "["):
            nums.update(value["nums"])
            current = value["confidence"]
            if current == "low" or (current == "medium" and confidence != "low"):
                confidence = current
            elif not confidence:
                confidence = current
    return {"nums": sorted(nums), "confidence": confidence}


def _suffix(by_field, prefix, visible):
    cites = cites_for(by_field, prefix)
    return ((" (check)" if cites["confidence"] == "low" else "")
            + "".join(f" [{n}]" for n in cites["nums"] if n in visible))


ACKS = {
    "en": "On it. I'll send the answer here in about half a minute.",
    "fi": "Selvä. Lähetän vastauksen tähän noin puolen minuutin kuluttua.",
    "sv": "Jag fixar det. Svaret kommer hit om ungefär en halv minut.",
    "ro": "Mă ocup. Îți trimit răspunsul aici în aproximativ jumătate de minut.",
    "de": "Mache ich. Die Antwort kommt in etwa einer halben Minute hierher.",
    "es": "Me encargo. Te envío la respuesta aquí en medio minuto.",
    "fr": "Je m'en occupe. Je t'envoie la réponse ici dans une trentaine de secondes.",
    "ru": "Занимаюсь. Пришлю ответ сюда примерно через полминуты.",
    "uk": "Займаюся. Надішлю відповідь сюди приблизно за пів хвилини.",
}


def render_ack(task, profile=None):
    # Plain words in the errand's language; the internal mode name means nothing to a user.
    return [ACKS.get((task.get("lang") or "en")[:2], ACKS["en"])]


WATCH_UPDATES = {
    "en": "New on your watch:",
    "fi": "Uutta seurannassasi:",
    "sv": "Nytt i din bevakning:",
    "ro": "Noutăți la urmărirea ta:",
    "de": "Neu bei deiner Beobachtung:",
    "es": "Novedades en tu seguimiento:",
    "fr": "Du nouveau dans ta veille :",
    "ru": "Новое по твоему отслеживанию:",
    "uk": "Нове у твоєму відстеженні:",
}

CHECKS = {
    "en": "Checking now with Exa. I'll message you here when it finishes.",
    "fi": "Tarkistan nyt Exalla. Viestitän tänne, kun se on valmis.",
    "sv": "Kollar nu med Exa. Jag skriver här när det är klart.",
    "ro": "Verific acum cu Exa. Îți scriu aici când termin.",
    "de": "Ich prüfe jetzt mit Exa. Ich schreibe dir hier, wenn es fertig ist.",
    "es": "Lo compruebo ahora con Exa. Te escribo aquí cuando termine.",
    "fr": "Je vérifie maintenant avec Exa. Je t'écris ici quand c'est fini.",
    "ru": "Проверяю сейчас через Exa. Напишу сюда, когда закончу.",
    "uk": "Перевіряю зараз через Exa. Напишу сюди, коли закінчу.",
}

NOTHING_NEW = {
    "en": "Checked with Exa just now: nothing new since last time. I'll keep watching daily.",
    "fi": "Tarkistin juuri Exalla: ei mitään uutta viime kerran jälkeen. Seuraan edelleen päivittäin.",
    "sv": "Kollade med Exa nyss: inget nytt sedan sist. Jag fortsätter bevaka dagligen.",
    "ro": "Am verificat acum cu Exa: nimic nou de data trecută. Urmăresc în continuare zilnic.",
    "de": "Gerade mit Exa geprüft: nichts Neues seit dem letzten Mal. Ich beobachte weiter täglich.",
    "es": "Lo acabo de comprobar con Exa: nada nuevo desde la última vez. Seguiré vigilando cada día.",
    "fr": "Vérifié avec Exa à l'instant : rien de nouveau depuis la dernière fois. Je continue à surveiller chaque jour.",
    "ru": "Только что проверил через Exa: ничего нового с прошлого раза. Продолжаю следить ежедневно.",
    "uk": "Щойно перевірив через Exa: нічого нового з минулого разу. Продовжую стежити щодня.",
}


def render_watch_update(criteria, update, lang="en"):
    # What was watched, the finding in at most two sentences, at most two links.
    finding = " ".join(re.sub(r"^new:\s*", "", str(update.get("text") or "")).split())
    finding = " ".join(re.split(r"(?<=[.!?])\s+", finding)[:2])[:400]
    links = [url for url in (_safe_url(s.get("url")) for s in update.get("sources") or []) if url][:2]
    header = WATCH_UPDATES.get((lang or "en")[:2], WATCH_UPDATES["en"])
    return split_messages("\n".join([f"*{header}* {_text(criteria)}", _text(finding), *links]))


def render_check(lang="en"):
    return [CHECKS.get((lang or "en")[:2], CHECKS["en"])]


def render_nothing_new(lang="en"):
    return [NOTHING_NEW.get((lang or "en")[:2], NOTHING_NEW["en"])]


def render_result(task, profile=None):
    if (task.get("research") or {}).get("status") == "failed":
        return render_error("Research failed. " + ((task.get("research") or {}).get("error") or "Please try again."))
    output = (task.get("research") or {}).get("output") or {}
    structured = output.get("structured") or {}
    numbered = number_sources(output.get("grounding"))
    sources, fields = numbered["sources"][:8], numbered["byField"]
    visible = {source["n"] for source in sources}
    answer = _text(structured.get("answer") or output.get("text") or "Vali is still researching this errand.", profile)
    sections = [f"*{answer}*" + _suffix(fields, "answer", visible)]
    facts = [f"• {_text(fact.get('label'), profile)}: {_text(fact.get('value'), profile)}"
             + _suffix(fields, f"key_facts[{i}]", visible)
             for i, fact in enumerate((structured.get("key_facts") or [])[:5])]
    if facts:
        sections.append("\n".join(facts))
    actions = [f"Reply {i + 1} to {_text(action.get('label') or 'continue', profile)}"
               + _suffix(fields, f"actions[{i}]", visible)
               for i, action in enumerate((structured.get("actions") or [])[:9])]
    if actions:
        sections.append("\n".join(actions))
    questions = structured.get("missing_info") or []
    if questions:
        sections.append("*Missing information*\n" + "\n".join(f"• {_text(q, profile)}" for q in questions))
    if sources:
        sections.append("*Sources*\n" + "\n".join(
            f"[{s['n']}] {_text(s['title'], profile)} – {s['url']}" for s in sources))
    return split_messages("\n\n".join(sections))


def render_execution_update(task, profile=None):
    execution = task.get("execution") or {}
    status = execution.get("status")
    if status == "awaiting_approval":
        approval = execution.get("approval") or {}
        message = "Ready to submit: " + _text(approval.get("summary") or "the prepared form", profile).rstrip(".") + "."
        filled = approval.get("filled") or []
        if filled:
            message += "\nFilled: " + "; ".join(
                f"{_text(item.get('label'), profile)}: {_text(item.get('value'), profile)}" for item in filled)
        message += "\nReply *yes* to submit or *stop*."
    elif status == "done":
        message = _text(execution.get("result") or "Done.", profile)
    elif status == "failed":
        message = "Vali could not finish: " + _text(execution.get("error") or "the page could not be completed", profile)
        url = execution.get("final_url") or execution.get("current_url") or execution.get("start_url")
        if url:
            message += f"\nfinish here: {url}"
    elif status == "stopped":
        message = "Stopped. Vali will not submit this errand."
    elif status == "submitting":
        message = "Submitting your approved errand."
    else:
        steps = execution.get("steps") or []
        last = steps[-1].get("text") if steps else "starting your errand"
        message = "Working on it: " + _text(last, profile)
    return split_messages(message)


def render_help():
    return ["*Vali* takes care of your errands.\nTo pair, open the Vali extension, get your 6-digit code, and send *link 123456* (use your own code).\nSend an errand in text, a voice note, or a photo of a letter. Reply with an action number, *yes* to approve, *stop* to stop, or *status* for an update."]


def render_linked():
    return ["Linked! Your Vali extension and WhatsApp now share one task list. Send me an errand."]


def render_link_failed():
    return ["That pairing code is invalid or expired. Get a new 6-digit code from the Vali extension and send *link 123456* (use your own code)."]


def render_link_paused():
    return ["Linking is paused for now after too many wrong codes. Please try again in an hour."]


def render_error(message):
    return split_messages("Vali: " + _text(message))

"""Keep profile values at the browser boundary."""
import re


def substitute(text: str, profile: dict[str, str]) -> str:
    def replace(match):
        key = match.group(1)
        if key not in profile:
            raise ValueError(f"Missing profile placeholder: {key}")
        return str(profile[key])
    return re.sub(r"\{\{([^{}]+)\}\}", replace, text)


def mask(text: str, profile: dict[str, str]) -> str:
    values = sorted(((str(value), key) for key, value in profile.items() if value),
                    key=lambda item: len(item[0]), reverse=True)
    if not values:
        return text
    keys = {value.casefold(): key for value, key in values}
    pattern = re.compile('|'.join(re.escape(value) for value, _ in values), re.I)
    # One pass prevents inserted placeholders from being masked again.
    return pattern.sub(lambda match: '{{' + keys[match.group().casefold()] + '}}', text)

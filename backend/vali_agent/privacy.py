"""Keep profile values at the browser boundary."""
import re

# Not identifying on their own, and the agent needs them to read local pages ("City of Helsinki"):
# typed through placeholders like the rest, but never masked or blurred.
PUBLIC_FIELDS = {'city', 'country', 'nationality', 'language'}


def private_values(profile: dict[str, str]) -> dict[str, str]:
    """The profile fields that must never reach the model, the store or a screenshot."""
    return {key: str(value) for key, value in (profile or {}).items() if value and key not in PUBLIC_FIELDS}


def substitute(text: str, profile: dict[str, str]) -> str:
    def replace(match):
        key = match.group(1)
        if key not in profile:
            raise ValueError(f"Missing profile placeholder: {key}")
        return str(profile[key])
    return re.sub(r"\{\{([^{}]+)\}\}", replace, text)


def mask(text: str, profile: dict[str, str]) -> str:
    values = sorted(((value, key) for key, value in private_values(profile).items()),
                    key=lambda item: len(item[0]), reverse=True)
    if not values:
        return text
    keys = {value.casefold(): key for value, key in values}
    pattern = re.compile('|'.join(re.escape(value) for value, _ in values), re.I)
    # One pass prevents inserted placeholders from being masked again.
    return pattern.sub(lambda match: '{{' + keys[match.group().casefold()] + '}}', text)

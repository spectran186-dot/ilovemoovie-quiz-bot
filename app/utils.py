import re
import unicodedata

def normalize_answer(value: str) -> str:
    value = value.casefold().replace('ё', 'е')
    value = unicodedata.normalize('NFKC', value)
    value = re.sub(r'[^\w\s]', ' ', value, flags=re.UNICODE)
    return ' '.join(value.split())

def is_correct(user_answer: str, accepted: list[str]) -> bool:
    candidate = normalize_answer(user_answer)
    return bool(candidate) and any(candidate == normalize_answer(item) for item in accepted)

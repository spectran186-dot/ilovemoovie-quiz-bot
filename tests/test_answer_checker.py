from app.utils import is_correct, normalize_answer


def test_normalization_handles_yo_case_and_punctuation():
    assert normalize_answer("Ёжик в тумане!") == "ежик в тумане"


def test_exact_alias_with_punctuation():
    assert is_correct("Братство кольца!", ["Властелин колец", "Братство кольца"])


def test_wrong_answer_is_rejected():
    assert not is_correct("Матрица", ["Начало"])


def test_empty_answer_is_rejected():
    assert not is_correct("   ", ["Начало"])


def test_matching_is_not_loose_substring():
    assert not is_correct("Начало", ["Начало: Особое издание"])

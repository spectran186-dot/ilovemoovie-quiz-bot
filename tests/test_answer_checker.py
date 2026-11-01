from app.utils import is_correct, normalize_answer

def test_normalization():
    assert normalize_answer('Ёжик в тумане!') == 'ежик в тумане'

def test_aliases_and_punctuation():
    assert is_correct('Властелин колец: Братство кольца!', ['Властелин колец', 'Братство кольца'])

def test_wrong_answer():
    assert not is_correct('Матрица', ['Начало'])

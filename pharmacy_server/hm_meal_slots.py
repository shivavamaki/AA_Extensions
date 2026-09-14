"""Canonical Home Medication meal-slot classification."""
import re


SLOTS = (
    ('bbf', r'เช้า|breakfast|morning', True),
    ('abf', r'เช้า|breakfast|morning', False),
    ('blu', r'กลางวัน|เที่ยง|lunch|noon|midday', True),
    ('alu', r'กลางวัน|เที่ยง|lunch|noon|midday', False),
    ('bdn', r'เย็น|dinner|supper|evening', True),
    ('adn', r'เย็น|dinner|supper|evening', False),
)
QUALIFIER_RE = re.compile(r'ก่อน|หลัง|before|after|\bac\b|\bpc\b|'+
                           r'เช้า|กลางวัน|เที่ยง|เย็น|breakfast|lunch|noon|midday|'+
                           r'dinner|supper|evening|morning', re.I)


def _qualifier(token):
    token = token.lower()
    if token in ('ก่อน', 'before', 'ac'):
        return 'before'
    if token in ('หลัง', 'after', 'pc'):
        return 'after'
    return ''


def _meal_qualifier(text, meal_pattern):
    qualifier = ''
    for match in QUALIFIER_RE.finditer(text):
        token = match.group(0)
        found = _qualifier(token)
        if found:
            qualifier = found
        elif re.search(meal_pattern, token, re.I):
            return qualifier
    return ''


def classify(text):
    """Return stable slot keys using the same before/after rules as the UI."""
    text = str(text or '')
    result = []
    for key, meal_pattern, wants_before in SLOTS:
        if not re.search(meal_pattern, text, re.I):
            continue
        qualifier = _meal_qualifier(text, meal_pattern)
        if (wants_before and qualifier == 'before') or (not wants_before and qualifier != 'before'):
            result.append(key)
    if not result and re.search(r'once\s*daily|วันละ\s*1\s*ครั้ง|วันละครั้ง', text, re.I):
        result.append('abf')
    if re.search(r'ก่อนนอน|ก่อนเข้านอน|bedtime|bed\s*time|\bhs\b|at\s+night', text, re.I):
        result.append('bed')
    if re.search(r'เมื่อมีอาการ|เวลามีอาการ|เมื่อปวด|เมื่อจำเป็น|\bprn\b|if\s+needed|as\s+needed|when\s+required', text, re.I):
        result.append('prn')
    return result


def annotate(medicines):
    """Add server-owned mealSlots metadata without changing existing fields."""
    for medicine in medicines or []:
        if not isinstance(medicine, dict):
            continue
        text = ' '.join(str(medicine.get(field) or '') for field in ('instruction', 'frequencyTh'))
        medicine['mealSlots'] = classify(text)
    return medicines
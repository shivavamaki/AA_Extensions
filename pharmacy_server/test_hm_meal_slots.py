import unittest

from hm_meal_slots import annotate, classify


class MealSlotsTest(unittest.TestCase):
    def test_english_before_after_and_special_slots(self):
        self.assertEqual(classify('Take after breakfast and dinner'), ['abf', 'adn'])
        self.assertEqual(classify('Take before breakfast PRN'), ['bbf', 'prn'])
        self.assertEqual(classify('Once daily'), ['abf'])

    def test_thai_qualifier_carries_across_meals(self):
        self.assertEqual(classify('หลังอาหาร เช้า เย็น'), ['abf', 'adn'])
        self.assertEqual(classify('ก่อนนอน'), ['bed'])

    def test_annotate_preserves_rows(self):
        rows = [{'drug': 'A', 'instruction': 'after lunch', 'frequencyTh': ''}]
        self.assertIs(annotate(rows), rows)
        self.assertEqual(rows[0]['mealSlots'], ['alu'])


if __name__ == '__main__':
    unittest.main()
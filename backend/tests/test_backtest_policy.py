import math
import unittest

from app.risk.backtest_policy import evaluate_eligibility


class BacktestPolicyTests(unittest.TestCase):
    def test_missing_or_invalid_metrics_are_ineligible(self) -> None:
        valid_result = {
            "netProfit": 1,
            "totalTrades": 5,
            "maxDrawdown": 10,
        }
        invalid_values = (None, True, "5", math.nan, math.inf, -math.inf)

        for metric in valid_result:
            with self.subTest(metric=metric, missing=True):
                result = valid_result.copy()
                del result[metric]
                eligible, reason = evaluate_eligibility(result)
                self.assertFalse(eligible)
                self.assertIn(metric, reason)

            for value in invalid_values:
                with self.subTest(metric=metric, value=value):
                    result = {**valid_result, metric: value}
                    eligible, reason = evaluate_eligibility(result)
                    self.assertFalse(eligible)
                    self.assertIn(metric, reason)


if __name__ == "__main__":
    unittest.main()

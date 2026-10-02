from __future__ import annotations

import random
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any


class OperationsSimulator:
    """Local-only operational telemetry simulator for the parking POC.

    It generates believable, non-production dashboard telemetry: entries, exits,
    fees, overdue charges and a short activity feed. Real deployments can replace
    this class with events from gate controllers, payment systems and sensors.
    """

    def __init__(self, history_size: int = 20) -> None:
        self.history_size = history_size
        self.rng = random.Random(20261002)
        self.entries_today = self.rng.randint(1180, 1420)
        self.exits_today = self.entries_today - self.rng.randint(40, 140)
        self.fees_today = round(self.rng.uniform(32000, 46000), 2)
        self.due_today = round(self.rng.uniform(1800, 5200), 2)
        self.avg_stay_minutes = self.rng.randint(58, 86)
        self._series: deque[dict[str, Any]] = deque(maxlen=history_size)
        self._activities: deque[dict[str, Any]] = deque(maxlen=20)
        self._seed_history()

    def _seed_history(self) -> None:
        now = datetime.now(timezone.utc)
        cumulative_entries = max(0, self.entries_today - self.rng.randint(40, 90))
        cumulative_exits = max(0, self.exits_today - self.rng.randint(35, 85))
        cumulative_fees = max(0.0, self.fees_today - self.rng.uniform(2400, 5200))
        cumulative_due = max(0.0, self.due_today - self.rng.uniform(250, 900))
        for idx in range(self.history_size):
            t = now - timedelta(minutes=(self.history_size - idx) * 2)
            entries = self.rng.randint(5, 18)
            exits = self.rng.randint(4, 16)
            fees = round(self.rng.uniform(180, 820), 2)
            due = round(self.rng.uniform(10, 180), 2)
            cumulative_entries += entries
            cumulative_exits += exits
            cumulative_fees += fees
            cumulative_due += due
            self._series.append(
                {
                    "time": t.isoformat(),
                    "label": t.astimezone().strftime("%H:%M"),
                    "entries": entries,
                    "exits": exits,
                    "fees": fees,
                    "due": due,
                    "cumulative_entries": cumulative_entries,
                    "cumulative_exits": cumulative_exits,
                    "cumulative_fees": round(cumulative_fees, 2),
                    "cumulative_due": round(cumulative_due, 2),
                }
            )

        for _ in range(8):
            self._push_activity(initial=True)

    def _push_activity(self, initial: bool = False, *, entry: int = 0, exit: int = 0, fee: float = 0, due: float = 0) -> None:
        now = datetime.now(timezone.utc)
        options = [
            ("ENTRY", "Vehicle entered", "Gate A", "arrival"),
            ("ENTRY", "Vehicle entered", "Gate B", "arrival"),
            ("EXIT", "Vehicle exited", "Gate C", "departure"),
            ("EV", "EV charging session started", "P2 · EV-06", "charging"),
            ("RESERVATION", "Reservation confirmed", "P1 · A02", "reservation"),
            ("ALERT", "Parking due charge posted", "Account · Visitor", "due"),
            ("PAYMENT", "Parking fee collected", "Payment lane", "payment"),
        ]
        kind, message, location, icon = self.rng.choice(options)
        if entry:
            kind, message, location, icon = "ENTRY", "Vehicle entered", self.rng.choice(["Gate A", "Gate B", "Gate C"]), "arrival"
        elif exit:
            kind, message, location, icon = "EXIT", "Vehicle exited", self.rng.choice(["Gate A", "Gate B", "Gate C"]), "departure"
        elif fee:
            kind, message, location, icon = "PAYMENT", f"Parking fee collected · ₹{fee:,.0f}", "Payment lane", "payment"
        elif due:
            kind, message, location, icon = "ALERT", f"Overstay due charge · ₹{due:,.0f}", "Exit exception", "due"
        elif initial:
            pass
        self._activities.appendleft(
            {
                "time": now.isoformat(),
                "label": now.astimezone().strftime("%H:%M:%S"),
                "kind": kind,
                "message": message,
                "location": location,
                "icon": icon,
            }
        )

    def tick(self, occupancy_pct: float | None = None) -> dict[str, Any]:
        entries = self.rng.randint(1, 5)
        exits = self.rng.randint(1, 4)
        fee = round(self.rng.uniform(45, 260) if self.rng.random() < 0.75 else self.rng.uniform(0, 40), 2)
        due = round(self.rng.uniform(15, 140) if self.rng.random() < 0.30 else 0, 2)

        self.entries_today += entries
        self.exits_today += exits
        self.fees_today = round(self.fees_today + fee, 2)
        self.due_today = round(self.due_today + due, 2)
        self.avg_stay_minutes = max(35, min(120, self.avg_stay_minutes + self.rng.choice([-1, 0, 0, 1])))

        previous = self._series[-1] if self._series else {
            "cumulative_entries": self.entries_today,
            "cumulative_exits": self.exits_today,
            "cumulative_fees": self.fees_today,
            "cumulative_due": self.due_today,
        }
        now = datetime.now(timezone.utc)
        self._series.append(
            {
                "time": now.isoformat(),
                "label": now.astimezone().strftime("%H:%M:%S"),
                "entries": entries,
                "exits": exits,
                "fees": fee,
                "due": due,
                "cumulative_entries": previous["cumulative_entries"] + entries,
                "cumulative_exits": previous["cumulative_exits"] + exits,
                "cumulative_fees": round(previous["cumulative_fees"] + fee, 2),
                "cumulative_due": round(previous["cumulative_due"] + due, 2),
            }
        )

        self._push_activity(entry=entries if entries else 0)
        if self.rng.random() < 0.70:
            self._push_activity(exit=exits)
        if fee >= 40:
            self._push_activity(fee=fee)
        if due > 0:
            self._push_activity(due=due)

        return self.snapshot(occupancy_pct=occupancy_pct)

    def snapshot(self, occupancy_pct: float | None = None) -> dict[str, Any]:
        latest = self._series[-1] if self._series else {}
        return {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "entries_today": self.entries_today,
            "exits_today": self.exits_today,
            "net_entries": self.entries_today - self.exits_today,
            "fees_today": round(self.fees_today, 2),
            "due_today": round(self.due_today, 2),
            "avg_stay_minutes": self.avg_stay_minutes,
            "occupancy_pct": round(occupancy_pct or 0, 1),
            "last_interval": {
                "entries": latest.get("entries", 0),
                "exits": latest.get("exits", 0),
                "fees": latest.get("fees", 0),
                "due": latest.get("due", 0),
            },
            "series": list(self._series),
            "activities": list(self._activities),
        }

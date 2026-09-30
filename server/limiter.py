"""A sliding-window rate limiter: at most `limit` events per `window` seconds per key."""
from __future__ import annotations

import threading
import time


class Limiter:
    def __init__(self, window: float):
        self.window = window
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = {}

    def _recent(self, key: str) -> list[float]:
        now = time.time()
        recent = [t for t in self._hits.get(key, []) if now - t < self.window]
        if recent:
            self._hits[key] = recent
        else:
            self._hits.pop(key, None)
        return recent

    def full(self, key: str, limit: int) -> bool:
        """True when `key` already used up `limit` events in the window (nothing is counted)."""
        with self._lock:
            return len(self._recent(key)) >= limit

    def _sweep(self) -> None:
        """Keys that never come back would stay in memory; drop the expired ones once there are many."""
        if len(self._hits) > 10_000:
            for key in list(self._hits):
                self._recent(key)

    def add(self, key: str) -> None:
        with self._lock:
            self._sweep()
            self._recent(key)
            self._hits.setdefault(key, []).append(time.time())

    def take(self, key: str, limit: int) -> bool:
        """Counts an event; False (and nothing counted) when the limit is already reached."""
        with self._lock:
            if len(self._recent(key)) >= limit:
                return False
            self._hits.setdefault(key, []).append(time.time())
            return True

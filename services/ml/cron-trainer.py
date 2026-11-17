"""Nightly cron trainer — fires POST /train at 04:00 AM every day.

Replaces the naive `while true; sleep 86400` loop with proper datetime math
so training always happens at exactly 04:00 local time regardless of start time.
"""
import datetime
import os
import time

import requests

ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "http://ml:8000")


def seconds_until_next_4am() -> float:
    now = datetime.datetime.now()
    target = now.replace(hour=4, minute=0, second=0, microsecond=0)
    if now >= target:
        target += datetime.timedelta(days=1)
    return (target - now).total_seconds()


def main() -> None:
    print(f"[cron-trainer] started — ML service: {ML_SERVICE_URL}", flush=True)
    while True:
        wait = seconds_until_next_4am()
        wake = datetime.datetime.now() + datetime.timedelta(seconds=wait)
        print(f"[cron-trainer] sleeping {wait/3600:.2f}h until {wake.strftime('%Y-%m-%d %H:%M')}", flush=True)
        time.sleep(wait)
        print("[cron-trainer] triggering /train …", flush=True)
        try:
            response = requests.post(f"{ML_SERVICE_URL}/train", timeout=15)
            print(f"[cron-trainer] /train → {response.status_code} {response.text}", flush=True)
        except Exception as exc:
            print(f"[cron-trainer] failed to reach ML service: {exc}", flush=True)


if __name__ == "__main__":
    main()

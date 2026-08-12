"""Market snapshot for the daily digest. Alerts/summary only — never places
trades or touches a brokerage account.
"""
import yfinance as yf

import config


def watchlist_snapshot() -> list[dict]:
    """Latest price + day change for each configured ticker.

    Best-effort: a failure on one ticker is skipped, not fatal.
    """
    out = []
    for symbol in config.WATCHLIST:
        try:
            hist = yf.Ticker(symbol).history(period="2d")
            if len(hist) < 2:
                continue
            prev_close = hist["Close"].iloc[-2]
            last = hist["Close"].iloc[-1]
            pct = (last - prev_close) / prev_close * 100
            out.append({
                "symbol": symbol,
                "price": round(float(last), 2),
                "pct_change": round(float(pct), 2),
            })
        except Exception:
            continue
    return out

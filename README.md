[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Adesudu/btc-race-bot-20261118/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Adesudu/btc-race-bot-20261118/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# Dip-Recovery Scalper BTC Bot

Trades Coinbase Wrapped BTC (cbBTC) against USDC, one minute at a time, in
the [make.fun `btc-race-24h-20261118-1444` competition](https://make.fun/bounty/btc-race-24h-20261118-1444).
Starts with 1,000 USDC of paper money, long only, at most one open position.

## Why this strategy

The dev window for this race is a slow grind down: BTC falls 281 bps from
the first close to the last, its biggest one-minute move is only 63 bps,
and its deepest drawdown is 324 bps. The previous race's bot (deep dip,
wide trailing stop, halfway fallback buy) loses $8.44 on this window, so
this bot is a mean-reversion scalper instead: it buys the recovery out of
a moderate dip and banks a small, fixed profit, never holding through the
drift.

## Strategy

- **Entry — buy the dip's recovery.** Wait until the close falls at least
  100 bps below the highest close of the last 120 bars, then buy the
  moment it recovers at least 15 bps from the low of that pullback.
- **Exit — bank it or cut it.** Take profit 80 bps above the entry close;
  a trailing stop 200 bps below the highest close since entry; a hard stop
  150 bps below the entry close. After a sell, a 30-bar cooldown keeps the
  bot out of the same chop.
- **No late entries.** No new position is opened in the last 30 bars: a
  buy there would be flattened at the close before it can reach its take
  profit, paying the round-trip fees for nothing.
- **No fallback buy.** On this window a halfway buy loses money, and the
  dip entries already fire several times, so the guardrail (at least 1
  trade) is met without one.
- **Size.** Every buy spends all available cash; every sell closes the
  whole position. Max slippage 200 bps.

All state is a pure function of the bars (bigint arithmetic, no clock, no
randomness), so two runs produce identical action logs.

## Local grade (kit's `grade-local`, dev window)

- **Net PnL: +$17.22 USDC** (return 1.72%), 3 round trips, 6 trades,
  win rate 100%, max drawdown 0.77%, 0 rejected orders
- Net PnL at 2x fees: +$14.79 — still positive with every fee doubled
- Guardrails met; L1 regrade reproduced byte for byte (deterministic)

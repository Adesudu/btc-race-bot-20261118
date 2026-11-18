// Dip-recovery BTC bot for make.fun btc-race-24h-20261118-1444.
//
// The dev window for this race is a slow grind down: BTC falls 281 bps
// from the first close to the last, its biggest one-minute move only 63
// bps, and its deepest drawdown 324 bps. The previous race's bot (deep
// dip, wide trailing stop, halfway fallback buy) loses $8.44 on this
// window: the trailing stop bleeds on the drift down and the fallback buy
// rides the decline. So this bot is a mean-reversion scalper instead: it
// buys the recovery out of a moderate dip and banks a small, fixed
// profit, never holding through the drift.
//
// Entry: the close falls at least 100 bps below the highest close of the
// last 120 bars, then recovers at least 15 bps from the low of that
// pullback. Exit: take profit 80 bps above the entry close, a trailing
// stop 200 bps below the peak since entry, or a hard stop 150 bps below
// the entry close. After a sell, a 30-bar cooldown keeps the bot from
// re-entering the same chop. No new position is opened in the last 30
// bars: a buy there would be flattened at the close before it can reach
// its take profit, paying the round-trip fees for nothing. No fallback
// buy: on this window a halfway buy loses money, and the dip entries
// already fire several times, so the guardrail (at least 1 trade) is met
// without one.
//
// Position: one open position only, full cash on every buy, full quantity
// on every sell. All arithmetic is bigint, all state is a pure function
// of the bars, so two runs produce identical action logs.
//
// Tuned on the kit's dev window (1,440 one-minute bars) with a local
// simulator of the harness fill model, then verified with the kit's
// grade-local: +$17.22 net PnL, 3 round trips, 0.77% max drawdown. The
// parameters sit in a broad positive region (dip 95-110 bps, take profit
// 75-85 bps, recovery 10-20 bps all stay positive), not on a knife edge.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;

// Strategy parameters, in basis points / bars.
const LOOKBACK_BARS = 120; // window for the running high an entry is measured against
const DIP_BPS = 100n; // pullback from the running high that arms an entry
const RECOVERY_BPS = 15n; // bounce from the pullback low that triggers the buy
const TAKE_PROFIT_BPS = 80n; // gain above the entry close that banks the trade
const TRAIL_BPS = 200n; // trailing stop below the peak since entry
const HARD_STOP_BPS = 150n; // hard stop below the entry close
const COOLDOWN_BARS = 30; // bars to wait after a sell before re-entering
const NO_ENTRY_LAST_BARS = 30; // bars at the end of the window with no new entries
const TOTAL_BARS = 1440; // bars in the dev and race windows
const MAX_SLIPPAGE_BPS = 200; // bound on the move from the latest close to the fill

function belowBy(price: bigint, ref: bigint, bps: bigint): boolean {
  // True when price is at least `bps` basis points below ref.
  return price * BPS < ref * (BPS - bps);
}

function aboveBy(price: bigint, ref: bigint, bps: bigint): boolean {
  // True when price is at least `bps` basis points above ref.
  return price * BPS > ref * (BPS + bps);
}

interface BotState {
  closes: bigint[]; // last LOOKBACK_BARS closes, oldest first
  low: bigint; // low of the current pullback (0 when not armed)
  armed: boolean; // a >=DIP_BPS pullback has happened, waiting for recovery
  entryClose: bigint; // close at which the current position was decided
  peak: bigint; // highest close since entry
  lastSellBar: number; // tradable-bar index of the last sell, -1e9 if none
  barsSeen: number; // tradable bars seen so far
}

const bot: BotState = {
  closes: [],
  low: 0n,
  armed: false,
  entryClose: 0n,
  peak: 0n,
  lastSellBar: -1_000_000,
  barsSeen: 0,
};

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) {
      // No trading on warm-up bars, but still track the tape so the
      // running high is warm when the scored window starts.
      const close = state.close(SYMBOL);
      if (close !== null) {
        bot.closes.push(close);
        if (bot.closes.length > LOOKBACK_BARS) bot.closes.shift();
      }
      return [];
    }
    bot.barsSeen += 1;
    const close = state.close(SYMBOL);
    if (close === null) return [];
    bot.closes.push(close);
    if (bot.closes.length > LOOKBACK_BARS) bot.closes.shift();

    const pos = state.positions.get(SYMBOL);
    const qty = pos?.qty ?? 0n;

    if (qty > 0n) {
      // In a position: bank the take profit, or cut it on the stops.
      if (close > bot.peak) bot.peak = close;
      const profitHit = bot.entryClose > 0n && aboveBy(close, bot.entryClose, TAKE_PROFIT_BPS);
      const trailHit = belowBy(close, bot.peak, TRAIL_BPS);
      const stopHit = bot.entryClose > 0n && belowBy(close, bot.entryClose, HARD_STOP_BPS);
      if (profitHit || trailHit || stopHit) {
        bot.lastSellBar = bot.barsSeen;
        bot.low = 0n;
        bot.armed = false;
        bot.entryClose = 0n;
        bot.peak = 0n;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: no re-entry during the cooldown after a sell, and no new
    // position so late that the end-of-window flatten would eat it.
    if (bot.barsSeen - bot.lastSellBar < COOLDOWN_BARS) return [];
    if (bot.barsSeen > TOTAL_BARS - NO_ENTRY_LAST_BARS) return [];

    // Dip-recovery entry: arm on a pullback from the running high, buy
    // on the first bounce off the pullback low.
    let high = 0n;
    for (const c of bot.closes) if (c > high) high = c;
    if (high > 0n && belowBy(close, high, DIP_BPS)) {
      bot.armed = true;
      if (bot.low === 0n || close < bot.low) bot.low = close;
    }
    if (bot.armed) {
      if (close < bot.low) bot.low = close;
      if (bot.low > 0n && aboveBy(close, bot.low, RECOVERY_BPS)) {
        bot.armed = false;
        bot.low = 0n;
        bot.entryClose = close;
        bot.peak = close;
        if (state.cash <= 0n) return [];
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }
    return [];
  },
});

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  dataDelayMinutes: 15,
  delayedDataMode: true,
  optionsMode: false,
  cacheSeconds: 60,
  maxConcurrentRequests: 10
};

const API_KEY = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || '';
const cache = new Map();

const symbols = [
  'SPY','QQQ','XBI',
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','AVGO','TSLA',
  'JPM','LLY','V','MA','UNH','XOM','COST','NFLX','HD','PG',
  'ABBV','CRM','AMD','QCOM','ORCL','BAC','KO','PEP','CSCO',
  'WMT','MCD','ADBE','IBM','GE','CAT','GS','INTC','MRK',
  'DIS','TMO','AMGN','TXN','RGTI','SOUN','NEE','TE','SOFI','HIMS',
  'IONQ','QBTS','RKLB','ASTS','PLTR','MU','SMCI','ARM','CRWD','APP',
  'RXT','NVO','MRNA','WEN','RUN','AAL','TEM','UBER','JBLU',
  'LOW','HON','FOX','TER','BULL','DRAM','NOK','AIR','BRK.B',
  'CDW','SNOW','OSCR','SWKS','RDDT','AMKR','CRWV','MARA',
  'COIN','HOOD','WULF','EOSE','QUBT','NVTS','GLXY','HYLN',
  'WYFI','FPS','MRVL','ONDS','GH','ILMN','DELL','CBRS','BE'
];

async function polygon(pathname) {
  if (!API_KEY) throw new Error('Missing MASSIVE_API_KEY or POLYGON_API_KEY in Railway Variables');

  const url = `https://api.polygon.io${pathname}${pathname.includes('?') ? '&' : '?'}apiKey=${API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Polygon/Massive API error ${response.status}`);

  return response.json();
}

function timeframeToPolygon(tf) {
  switch (String(tf).toUpperCase()) {
    case '5M': return { multiplier: 5, timespan: 'minute', daysBack: 3, limit: 160 };
    case '15M': return { multiplier: 15, timespan: 'minute', daysBack: 7, limit: 160 };
    case '1H': return { multiplier: 1, timespan: 'hour', daysBack: 20, limit: 160 };
    case '4H': return { multiplier: 4, timespan: 'hour', daysBack: 60, limit: 180 };
    case '1D': return { multiplier: 1, timespan: 'day', daysBack: 240, limit: 240 };
    case '1W': return { multiplier: 1, timespan: 'week', daysBack: 730, limit: 160 };
    default: return { multiplier: 1, timespan: 'hour', daysBack: 20, limit: 160 };
  }
}

function dateAgo(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

async function runLimited(items, limit, worker) {
  const results = [];
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(API_KEY),
    totalSymbols: symbols.length,
    delayedDataMode: CONFIG.delayedDataMode,
    delayMinutes: CONFIG.dataDelayMinutes
  });
});

app.get('/api/stocks', async (req, res) => {
  try {
    const timeframe = String(req.query.timeframe || '1H').toUpperCase();
    const tf = timeframeToPolygon(timeframe);

    const tickers = req.query.tickers
      ? String(req.query.tickers).split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
      : symbols;

    const safeTickers = tickers.length ? tickers : symbols;
    const cacheKey = `${timeframe}:${safeTickers.join(',')}`;

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CONFIG.cacheSeconds * 1000) {
      return res.json(cached.data);
    }

    if (!API_KEY) {
      return res.json({
        live: false,
        timeframe,
        count: symbols.length,
        stocks: demoStocks(timeframe)
      });
    }

    const from = dateAgo(tf.daysBack);
    const to = new Date().toISOString().slice(0, 10);

    const rawResults = await runLimited(safeTickers, CONFIG.maxConcurrentRequests, async ticker => {
      try {
        const data = await polygon(
          `/v2/aggs/ticker/${ticker}/range/${tf.multiplier}/${tf.timespan}/${from}/${to}?adjusted=true&sort=desc&limit=${tf.limit}`
        );

        const candles = data.results || [];
        if (!candles.length) return null;

        const latest = candles[0];
        const previous = candles[1] || latest;
        const orderedCandles = candles.slice().reverse();

        const price = Number(latest.c.toFixed(2));
        const change = Number((((latest.c - previous.c) / previous.c) * 100).toFixed(2));
        const spark = orderedCandles.map(c => Number(c.c.toFixed(2)));

        return {
          ticker,
          price,
          change,
          volume: latest.v || 0,
          spark,
          candles: orderedCandles,
          news: []
        };
      } catch (e) {
        console.error(`Failed ${ticker}:`, e.message);
        return null;
      }
    });

    const raw = rawResults.filter(Boolean);
    const spyChange = raw.find(x => x.ticker === 'SPY')?.change || 0;

    const stocks = raw
      .map(x => makeStock(x.ticker, x.price, x.change, x.volume, x.spark, timeframe, x.candles, spyChange, x.news))
      .sort((a, b) => b.score - a.score);

    const payload = {
      live: true,
      timeframe,
      delayMinutes: CONFIG.dataDelayMinutes,
      delayedDataMode: CONFIG.delayedDataMode,
      requestedCount: safeTickers.length,
      returnedCount: stocks.length,
      stocks
    };

    cache.set(cacheKey, { time: Date.now(), data: payload });
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      live: false,
      error: err.message,
      stocks: demoStocks(req.query.timeframe || '1H')
    });
  }
});

app.get('/api/news/:ticker', async (req, res) => {
  try {
    const ticker = String(req.params.ticker || '').toUpperCase();
    if (!ticker) return res.json({ ticker, news: [] });

    const data = await polygon(`/v2/reference/news?ticker=${ticker}&limit=5`);

    res.json({
      ticker,
      news: data.results || []
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      news: []
    });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`A+ Stocks running on port ${PORT}`);
});

function makeStock(ticker, price, change, volume, spark, timeframe = '1H', candles = [], spyChange = 0, news = []) {
  const sectorMap = {
    SPY:'ETF', QQQ:'ETF', XBI:'Biotech ETF',
    AAPL:'Technology', MSFT:'Technology', NVDA:'Technology', AMD:'Technology',
    QCOM:'Technology', AVGO:'Technology', ORCL:'Technology', CRM:'Technology',
    PLTR:'AI / Software', MU:'Semiconductors', SMCI:'Semiconductors',
    ARM:'Semiconductors', CRWD:'Cybersecurity', APP:'AI / Software',
    AMZN:'Consumer', META:'Technology', GOOGL:'Technology', TSLA:'Consumer',
    JPM:'Financials', BAC:'Financials', GS:'Financials', V:'Financials', MA:'Financials',
    LLY:'Healthcare', UNH:'Healthcare', ABBV:'Healthcare', MRK:'Healthcare',
    TMO:'Healthcare', AMGN:'Healthcare', XOM:'Energy', COST:'Consumer',
    NFLX:'Communication', HD:'Consumer', PG:'Consumer', KO:'Consumer',
    PEP:'Consumer', CSCO:'Technology', WMT:'Consumer', MCD:'Consumer',
    ADBE:'Technology', IBM:'Technology', GE:'Industrials', CAT:'Industrials',
    INTC:'Semiconductors', DIS:'Communication', TXN:'Semiconductors',
    RGTI:'Quantum', IONQ:'Quantum', QBTS:'Quantum', QUBT:'Quantum',
    SOUN:'AI', RKLB:'Space', ASTS:'Space', NEE:'Utilities', TE:'Industrials',
    SOFI:'Financials', HIMS:'Healthcare',
    RXT:'Software', NVO:'Healthcare', MRNA:'Healthcare', WEN:'Consumer',
    RUN:'Solar', AAL:'Airlines', TEM:'AI / Healthcare', UBER:'Technology',
    JBLU:'Airlines', LOW:'Consumer', HON:'Industrials', FOX:'Communication',
    TER:'Semiconductors', BULL:'Financials', DRAM:'Semiconductors',
    NOK:'Technology', AIR:'Industrials', 'BRK.B':'Financials',
    CDW:'Technology', SNOW:'Software', OSCR:'Healthcare',
    SWKS:'Semiconductors', RDDT:'Social Media', AMKR:'Semiconductors',
    CRWV:'AI / Cloud', MARA:'Crypto', COIN:'Crypto', HOOD:'Financials',
    WULF:'Crypto', EOSE:'Energy Storage', NVTS:'Semiconductors',
    GLXY:'Crypto', HYLN:'Clean Energy', WYFI:'Technology',
    FPS:'Technology', MRVL:'Semiconductors', ONDS:'Technology',
    GH:'Healthcare', ILMN:'Healthcare', DELL:'Technology',
    CBRS:'Technology', BE:'Clean Energy'
  };

  const closes = candles.length ? candles.map(c => c.c) : spark || [];
  const highs = candles.length ? candles.map(c => c.h) : closes;
  const lows = candles.length ? candles.map(c => c.l) : closes;
  const volumes = candles.length ? candles.map(c => c.v || 0) : [volume || 0];
  const ranges = candles.length ? candles.map(c => c.h - c.l) : [];

  const lookbackHighs = highs.slice(-21, -1);
  const lookbackLows = lows.slice(-21, -1);

  const support = Number((lookbackLows.length ? Math.min(...lookbackLows) : price).toFixed(2));
  const resistance = Number((lookbackHighs.length ? Math.max(...lookbackHighs) : price).toFixed(2));

  const avgVolume = avg(volumes);
  const currentVolume = Math.round(volume);
  const rvol = Number((volume / Math.max(avgVolume, 1)).toFixed(2));
  const volumeSpike = rvol >= 1.5;
  const dollarVolume = Number((price * volume).toFixed(0));

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema100 = ema(closes, 100);
  const ema200 = ema(closes, 200);

  const atr = calculateATR(candles, 14);
  const oldATR = candles.length > 25 ? calculateATR(candles.slice(0, -5), 14) : atr;
  const atrExpansion = atr > oldATR * 1.15;

  const bb = bollingerBands(closes, 20, 2);

  const bullishTrend = ema9 > ema21 && price > ema9;
  const above50 = ema50 ? price > ema50 : false;
  const above100 = ema100 ? price > ema100 : false;
  const above200 = ema200 ? price > ema200 : false;

  const relativeStrength = Number((change - spyChange).toFixed(2));
  const nearResistance = resistance > 0 ? ((resistance - price) / price) * 100 <= 1.5 : false;
  const nearSupport = support > 0 ? ((price - support) / price) * 100 <= 2 : false;

  const avgRange3 = avg(ranges.slice(-3));
  const avgRange20 = avg(ranges.slice(-20));
  const avgVol5 = avg(volumes.slice(-5));
  const avgVol10 = avg(volumes.slice(-10));
  const avgVol20 = avg(volumes.slice(-20));
  const last3Lows = lows.slice(-3);

  const entryZoneBuffer = CONFIG.delayedDataMode ? 0.015 : 0.008;

  const tightRange = atr > 0 && oldATR > 0 && atr < oldATR * 0.9;
  const rangeContraction = avgRange3 > 0 && avgRange20 > 0 && avgRange3 < avgRange20 * 0.5;
  const volDryUp = avgVol5 > 0 && avgVol20 > 0 && avgVol5 < avgVol20 * 0.7;
  const volExpansionSetup = volume < avgVol10 && nearResistance;

  const higherLows =
    last3Lows.length === 3 &&
    last3Lows[2] > last3Lows[1] &&
    last3Lows[1] > last3Lows[0];

  const distanceToEntry = resistance > 0
    ? Number((((resistance - price) / price) * 100).toFixed(2))
    : null;

  const prePositionZone =
    distanceToEntry !== null &&
    distanceToEntry > 0 &&
    distanceToEntry < entryZoneBuffer * 100;

  const proximityToTrigger =
    distanceToEntry !== null &&
    distanceToEntry >= 0 &&
    distanceToEntry < 0.8;

  const vwap = calculateVWAP(candles);

  const vwapPinning =
    vwap > 0 &&
    Math.abs(price - vwap) / vwap < 0.003;

  const priceFlat =
    avgRange3 > 0 &&
    avgRange20 > 0 &&
    avgRange3 < avgRange20 * 0.65;

  const flagPoleHeight = closes.length >= 15
    ? Number((((Math.max(...closes.slice(-15)) - Math.min(...closes.slice(-15))) / Math.max(Math.min(...closes.slice(-15)), 0.01)) * 100).toFixed(2))
    : 0;

  const consolidationDays = ranges
    .slice(-15)
    .filter(r => avgRange20 > 0 && r < avgRange20 * 0.75)
    .length;

  const flagPole =
    flagPoleHeight > 5 &&
    consolidationDays > 3 &&
    consolidationDays < 15 &&
    priceFlat;

  const recentHigh20 = highs.slice(-20).length ? Math.max(...highs.slice(-20)) : price;
  const recentLow20 = lows.slice(-20).length ? Math.min(...lows.slice(-20)) : price;

  const cupDepth =
    recentHigh20 > 0
      ? Number((((recentHigh20 - recentLow20) / recentHigh20) * 100).toFixed(2))
      : 0;

  const handleVolDry = avgVol5 > 0 && avgVol20 > 0 && avgVol5 < avgVol20 * 0.75;

  const cupHandle =
    cupDepth > 4 &&
    cupDepth < 15 &&
    handleVolDry &&
    higherLows;

  const hasNewsCatalyst = news.length > 0;
  const newsTitle = news[0]?.title || '';

  const pattern =
    nearResistance && bullishTrend && volumeSpike
      ? 'High volume breakout setup'
      : cupHandle
      ? 'Cup and handle setup'
      : flagPole
      ? 'Bull flag setup'
      : tightRange && volDryUp && prePositionZone
      ? 'Coiled pre-breakout setup'
      : nearResistance && bullishTrend
      ? 'Breakout setup'
      : nearSupport && bullishTrend
      ? 'Support bounce setup'
      : bullishTrend && rvol >= 1.2
      ? 'Momentum continuation'
      : bb.squeeze && bullishTrend
      ? 'Bollinger squeeze bullish'
      : change < -1.5
      ? 'Pullback / wait'
      : 'No clean setup';

  const scoreBreakdown = {
    bullishTrend: bullishTrend ? 15 : 0,
    above50EMA: above50 ? 8 : 0,
    above100EMA: above100 ? 6 : 0,
    above200EMA: above200 ? 8 : 0,
    relativeStrength: relativeStrength > 1 ? 12 : 0,
    tightRange: tightRange ? 12 : 0,
    rangeContraction: rangeContraction ? 10 : 0,
    higherLows: higherLows ? 10 : 0,
    volDryUp: volDryUp ? 10 : 0,
    volExpansionSetup: volExpansionSetup ? 8 : 0,
    prePositionZone: prePositionZone ? 15 : 0,
    proximityToTrigger: proximityToTrigger ? 8 : 0,
    rvol: rvol >= 2 ? 8 : rvol >= 1.5 ? 5 : 0,
    pattern: pattern.includes('setup') ? 8 : 0,
    flagPole: flagPole ? 8 : 0,
    cupHandle: cupHandle ? 10 : 0,
    vwapPinning: vwapPinning ? 5 : 0,
    bollingerMiddle: bb.aboveMiddle ? 5 : 0,
    bollingerSqueeze: bb.squeeze && bullishTrend ? 8 : 0,
    newsCatalyst: hasNewsCatalyst ? 10 : 0,
    liquidity:
      dollarVolume > 1000000000 ? 10 :
      dollarVolume > 500000000 ? 7 :
      dollarVolume > 100000000 ? 4 : 0,
    atrExpansion: atrExpansion ? 5 : 0,
    marketETF: ticker === 'SPY' || ticker === 'QQQ' ? 5 : 0,
    optionsSetupBonus:
      CONFIG.optionsMode && tightRange && volDryUp && prePositionZone ? 10 : 0
  };

  let score = Object.values(scoreBreakdown).reduce((a, b) => a + b, 0);
  score = Math.min(99, Math.round(score));

  const buffer = Math.max(atr * 0.1, price * 0.001);

  const entryZone = resistance > 0
    ? {
        trigger: Number((resistance + buffer).toFixed(2)),
        zoneLow: Number((resistance * (1 - entryZoneBuffer)).toFixed(2)),
        zoneHigh: Number(resistance.toFixed(2)),
        mode: CONFIG.delayedDataMode ? 'PRE-POSITION' : 'BREAKOUT',
        delayMinutes: CONFIG.dataDelayMinutes
      }
    : null;

  let entry = null;
  let stop = null;

  if (
    pattern === 'High volume breakout setup' ||
    pattern === 'Breakout setup' ||
    pattern === 'Coiled pre-breakout setup' ||
    pattern === 'Cup and handle setup' ||
    pattern === 'Bull flag setup'
  ) {
    entry = entryZone?.trigger || null;
    stop = entry ? Number((Math.min(support - buffer, entry - atr * 1.2)).toFixed(2)) : null;
  } else if (pattern === 'Support bounce setup') {
    entry = Number((Math.max(price, highs.at(-1) || price) + buffer).toFixed(2));
    stop = Number((support - buffer).toFixed(2));
  } else if (pattern === 'Momentum continuation' || pattern === 'Bollinger squeeze bullish') {
    entry = Number(((highs.at(-1) || price) + buffer).toFixed(2));
    stop = Number((Math.max(ema21 - buffer, price - atr * 1.5)).toFixed(2));
  }

  let t1 = null;
  let t2 = null;
  let rr = null;
  let pctToEntry = null;

  if (entry && stop && entry > stop) {
    const risk = entry - stop;
    t1 = Number((entry + risk * 2).toFixed(2));
    t2 = Number((entry + risk * 3).toFixed(2));
    rr = 2;
    pctToEntry = Number((((entry - price) / price) * 100).toFixed(2));
  }

  const status =
    !entry ? 'No Setup' :
    prePositionZone ? 'Pre-Position Watch' :
    pctToEntry <= 1 ? 'Alert' :
    pctToEntry <= 3 ? 'Watch' :
    'Waiting';

  const chartCandles = candles.map(c => ({
    time: new Date(c.t).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric'
    }),
    timestamp: c.t,
    open: Number(c.o.toFixed(2)),
    high: Number(c.h.toFixed(2)),
    low: Number(c.l.toFixed(2)),
    close: Number(c.c.toFixed(2)),
    volume: c.v || 0
  }));

  const tradePlan = buildTradePlan({
    ticker,
    price,
    candles,
    support,
    resistance,
    ema9,
    ema21,
    ema50,
    ema100,
    ema200,
    bb,
    vwap,
    atr,
    entryZone,
    pattern,
    timeframe
  });

  return {
    ticker,
    sector: sectorMap[ticker] || 'Other',
    score,
    scoreBreakdown,
    price,
    change,
    timeframe,
    ema9,
    ema21,
    ema50,
    ema100,
    ema200,
    above50,
    above100,
    above200,
    avgVolume: Math.round(avgVolume),
    currentVolume,
    volumeSpike,
    rvol,
    dollarVolume,
    entry,
    stop,
    t1,
    t2,
    rr,
    pctToEntry,
    entryZone,
    support,
    resistance,
    atr,
    oldATR,
    atrExpansion,
    bollinger: bb,
    relativeStrength,
    avgRange3,
    avgRange20,
    avgVol5,
    avgVol10,
    avgVol20,
    tightRange,
    rangeContraction,
    volDryUp,
    volExpansionSetup,
    distanceToEntry,
    prePositionZone,
    proximityToTrigger,
    higherLows,
    flagPoleHeight,
    consolidationDays,
    flagPole,
    cupDepth,
    handleVolDry,
    cupHandle,
    vwap,
    vwapPinning,
    priceFlat,
    hasNewsCatalyst,
    newsTitle,
    pattern,
    analysis: `Support $${support} | Resistance $${resistance} | EMA9 $${ema9} | EMA21 $${ema21} | EMA50 $${ema50} | EMA100 $${ema100} | EMA200 $${ema200} | Pattern: ${pattern}`,
    bullishTrend,
    status,
    delayedDataMode: CONFIG.delayedDataMode,
    delayMinutes: CONFIG.dataDelayMinutes,
    spark: spark && spark.length ? spark : [],
    chartCandles,
    tradePlan
  };
}

function buildTradePlan({
  ticker,
  price,
  candles,
  support,
  resistance,
  ema9,
  ema21,
  ema50,
  ema100,
  ema200,
  bb,
  vwap,
  atr,
  entryZone,
  pattern,
  timeframe
}) {
  const last = candles.at(-1);
  const previous = candles.at(-2);

  const lastOpen = last?.o || price;
  const lastHigh = last?.h || price;
  const lastLow = last?.l || price;
  const lastClose = last?.c || price;
  const prevClose = previous?.c || lastClose;

  const bodyHigh = Math.max(lastOpen, lastClose);
  const bodyLow = Math.min(lastOpen, lastClose);
  const candleBody = Math.abs(lastClose - lastOpen);
  const candleRange = Math.max(lastHigh - lastLow, 0.01);
  const bodyStrengthPct = Number(((candleBody / candleRange) * 100).toFixed(1));

  const shelf = support;
  const reclaimClose = Number((shelf * 1.012).toFixed(2));
  const breakdownClose = Number((shelf * 0.995).toFixed(2));

  const shelfReclaim =
    lastClose >= reclaimClose &&
    (bodyLow > shelf || (lastOpen < shelf && lastClose > shelf));

  const shelfBreakdown =
    lastClose < breakdownClose ||
    bodyHigh < shelf;

  const preBreakoutZoneLow = bb.middle > 0
    ? Number(bb.middle.toFixed(2))
    : Number((resistance * 0.955).toFixed(2));

  const preBreakoutZoneHigh = ema50 > 0
    ? Number(ema50.toFixed(2))
    : Number((resistance * 0.985).toFixed(2));

  const inPreBreakoutZone =
    lastClose >= preBreakoutZoneLow &&
    lastClose <= preBreakoutZoneHigh;

  const aboveResistance = lastClose > resistance;
  const belowEma200 = ema200 > 0 && lastClose < ema200;
  const aboveEma200 = ema200 > 0 && lastClose > ema200;
  const emaStackBullish = ema9 > ema21 && ema21 > ema50;
  const emaStackBearish = ema9 < ema21 && ema21 < ema50;

  let planStatus = 'WAIT FOR CLOSE';

  if (shelfBreakdown) {
    planStatus = 'VP SHELF BREAKDOWN';
  } else if (shelfReclaim && lastClose < preBreakoutZoneLow) {
    planStatus = 'SHELF RECLAIMED - WAIT FOR BB MID / EMA ZONE';
  } else if (inPreBreakoutZone) {
    planStatus = 'PRE-BREAKOUT ADD ZONE';
  } else if (lastClose > preBreakoutZoneHigh && lastClose < resistance) {
    planStatus = 'HOLDING ABOVE EMA50 - WATCH RESISTANCE';
  } else if (aboveResistance && belowEma200) {
    planStatus = 'AGGRESSIVE LONG ONLY - BELOW EMA200';
  } else if (aboveResistance && aboveEma200) {
    planStatus = 'TREND CONFIRMED ABOVE EMA200';
  }

  const action =
    planStatus === 'VP SHELF BREAKDOWN'
      ? 'Do not average down. Cut weak shares or hedge.'
      : planStatus === 'PRE-BREAKOUT ADD ZONE'
      ? 'Valid add zone only if next candle holds above this zone.'
      : planStatus.includes('AGGRESSIVE')
      ? 'Small size only until EMA200 confirms.'
      : planStatus.includes('TREND CONFIRMED')
      ? 'Trend-following long is valid.'
      : 'Wait. No chase. Use only closed candles.';

  return {
    ticker,
    timeframe,
    currentPrice: Number(price.toFixed(2)),
    pattern,
    keyLevels: [
      { label: 'VP Shelf / Support', price: shelf },
      { label: 'Breakdown Close', price: breakdownClose },
      { label: 'Reclaim Close', price: reclaimClose },
      { label: 'BB Mid', price: bb.middle || null },
      { label: 'VWAP', price: vwap || null },
      { label: 'EMA9', price: ema9 || null },
      { label: 'EMA21', price: ema21 || null },
      { label: 'EMA50', price: ema50 || null },
      { label: 'EMA100', price: ema100 || null },
      { label: 'Resistance', price: resistance },
      { label: 'EMA200', price: ema200 || null },
      { label: 'Entry Trigger', price: entryZone?.trigger || null }
    ].filter(x => x.price),
    lastCandle: {
      open: Number(lastOpen.toFixed(2)),
      high: Number(lastHigh.toFixed(2)),
      low: Number(lastLow.toFixed(2)),
      close: Number(lastClose.toFixed(2)),
      previousClose: Number(prevClose.toFixed(2)),
      bodyHigh: Number(bodyHigh.toFixed(2)),
      bodyLow: Number(bodyLow.toFixed(2)),
      bodyStrengthPct
    },
    rules: {
      shelfRegain: `Close >= ${reclaimClose} and candle body accepts above ${shelf}`,
      shelfBreakdown: `Close < ${breakdownClose} or full candle body below ${shelf}`,
      preBreakoutAddZone: `${preBreakoutZoneLow} - ${preBreakoutZoneHigh}`,
      breakoutTrigger: `Close above ${resistance}`,
      trendConfirmation: ema200 > 0 ? `Best confirmation is close above EMA200 ${ema200}` : 'EMA200 not enough data',
      delayedDataRule: 'Use only closed candles. Ignore wick breaks and 1-minute moves.',
      flowRule: 'Early flow = appears near VP shelf before breakout. Late flow = appears after price reaches resistance.'
    },
    tradeLogic: {
      shelfReclaim,
      shelfBreakdown,
      inPreBreakoutZone,
      aboveResistance,
      belowEma200,
      aboveEma200,
      emaStackBullish,
      emaStackBearish,
      status: planStatus
    },
    riskPlan: {
      atr,
      invalidation: shelfBreakdown ? breakdownClose : shelf,
      noChaseZone: `${preBreakoutZoneHigh} - ${resistance}`,
      action
    }
  };
}

function ema(values, period) {
  if (!values || !values.length) return 0;

  const usable = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!usable.length) return 0;

  const k = 2 / (period + 1);
  let result = usable[0];

  for (let i = 1; i < usable.length; i++) {
    result = usable[i] * k + result * (1 - k);
  }

  return Number(result.toFixed(2));
}

function calculateATR(candles, period = 14) {
  if (!candles || candles.length < 2) return 0;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;

    trs.push(Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    ));
  }

  const recent = trs.slice(-period);
  const atr = recent.reduce((sum, v) => sum + v, 0) / Math.max(recent.length, 1);

  return Number(atr.toFixed(2));
}

function bollingerBands(values, period = 20, multiplier = 2) {
  if (!values || values.length < period) {
    return {
      upper: 0,
      middle: 0,
      lower: 0,
      width: 0,
      squeeze: false,
      aboveMiddle: false,
      nearUpper: false
    };
  }

  const recent = values.slice(-period);
  const middle = recent.reduce((sum, v) => sum + v, 0) / period;
  const variance = recent.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / period;
  const std = Math.sqrt(variance);

  const upper = middle + multiplier * std;
  const lower = middle - multiplier * std;
  const width = ((upper - lower) / middle) * 100;
  const price = values.at(-1);

  return {
    upper: Number(upper.toFixed(2)),
    middle: Number(middle.toFixed(2)),
    lower: Number(lower.toFixed(2)),
    width: Number(width.toFixed(2)),
    squeeze: width <= 8,
    aboveMiddle: price > middle,
    nearUpper: price >= upper * 0.98
  };
}

function avg(values) {
  if (!values || !values.length) return 0;

  const usable = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!usable.length) return 0;

  return Number((usable.reduce((sum, v) => sum + v, 0) / usable.length).toFixed(2));
}

function calculateVWAP(candles) {
  if (!candles || !candles.length) return 0;

  let pv = 0;
  let vol = 0;

  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    pv += typical * (c.v || 0);
    vol += c.v || 0;
  }

  if (!vol) return 0;
  return Number((pv / vol).toFixed(2));
}

function demoStocks(timeframe = '1H') {
  return symbols
    .map((s, i) =>
      makeStock(
        s,
        80 + Math.random() * 420,
        -2 + Math.random() * 5,
        1000000 + i,
        null,
        timeframe
      )
    )
    .sort((a, b) => b.score - a.score);
}

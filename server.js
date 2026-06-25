import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || '';

async function polygon(pathname) {
  if (!API_KEY) throw new Error('Missing MASSIVE_API_KEY or POLYGON_API_KEY in Railway Variables');

  const url = `https://api.polygon.io${pathname}${pathname.includes('?') ? '&' : '?'}apiKey=${API_KEY}`;
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Polygon/Massive API error ${response.status}`);

  return response.json();
}

const symbols = [
  'SPY','QQQ',
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','AVGO','TSLA',
  'JPM','LLY','V','MA','UNH','XOM','COST','NFLX','HD','PG',
  'ABBV','CRM','AMD','QCOM','ORCL','BAC','KO','PEP','CSCO',
  'WMT','MCD','ADBE','IBM','GE','CAT','GS','INTC','MRK',
  'DIS','TMO','AMGN','TXN','RGTI','SOUN','NEE','TE','SOFI','HIMS',
  'IONQ','QBTS','RKLB','ASTS','PLTR','MU','SMCI','ARM','CRWD','APP'
];

function timeframeToPolygon(tf) {
  switch (tf) {
    case '5M': return { multiplier: 5, timespan: 'minute', daysBack: 3 };
    case '15M': return { multiplier: 15, timespan: 'minute', daysBack: 5 };
    case '1H': return { multiplier: 1, timespan: 'hour', daysBack: 10 };
    case '1W': return { multiplier: 1, timespan: 'week', daysBack: 365 };
    case '1D':
    default: return { multiplier: 1, timespan: 'day', daysBack: 120 };
  }
}

function dateAgo(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

app.get('/api/stocks', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '1H';
    const tf = timeframeToPolygon(timeframe);

    if (!API_KEY) {
      return res.json({ live: false, timeframe, stocks: demoStocks(timeframe) });
    }

    const tickers = (req.query.tickers || symbols.join(','))
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(Boolean);

    const from = dateAgo(tf.daysBack);
    const to = new Date().toISOString().slice(0, 10);

    const raw = [];

    for (const ticker of tickers) {
      try {
        const data = await polygon(
          `/v2/aggs/ticker/${ticker}/range/${tf.multiplier}/${tf.timespan}/${from}/${to}?adjusted=true&sort=desc&limit=80`
        );

        const candles = data.results || [];
        if (!candles.length) continue;

        const latest = candles[0];
        const previous = candles[1] || latest;
        const orderedCandles = candles.slice().reverse();

        const price = Number(latest.c.toFixed(2));
        const change = Number((((latest.c - previous.c) / previous.c) * 100).toFixed(2));
        const spark = orderedCandles.map(c => Number(c.c.toFixed(2)));

        let news = [];
        try {
          const newsData = await polygon(`/v2/reference/news?ticker=${ticker}&limit=3`);
          news = newsData.results || [];
        } catch {
          news = [];
        }

        raw.push({
          ticker,
          price,
          change,
          volume: latest.v || 0,
          spark,
          candles: orderedCandles,
          news
        });
      } catch (e) {
        console.error(`Failed ${ticker}:`, e.message);
      }
    }

    const spyChange = raw.find(x => x.ticker === 'SPY')?.change || 0;

    const stocks = raw
      .map(x => makeStock(
        x.ticker,
        x.price,
        x.change,
        x.volume,
        x.spark,
        timeframe,
        x.candles,
        spyChange,
        x.news
      ))
      .sort((a, b) => b.score - a.score);

    res.json({
      live: true,
      timeframe,
      stocks: stocks.length ? stocks : demoStocks(timeframe)
    });

  } catch (err) {
    res.status(500).json({
      live: false,
      error: err.message,
      stocks: demoStocks(req.query.timeframe || '1H')
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
    SPY:'ETF', QQQ:'ETF',
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
    RGTI:'Quantum', IONQ:'Quantum', QBTS:'Quantum', SOUN:'AI',
    RKLB:'Space', ASTS:'Space', NEE:'Utilities', TE:'Industrials',
    SOFI:'Financials', HIMS:'Healthcare'
  };

  const closes = candles.length ? candles.map(c => c.c) : spark || [];
  const highs = candles.length ? candles.map(c => c.h) : closes;
  const lows = candles.length ? candles.map(c => c.l) : closes;
  const volumes = candles.length ? candles.map(c => c.v || 0) : [volume || 0];

  const recentHigh = Math.max(...highs.slice(-21, -1));
  const recentLow = Math.min(...lows.slice(-21, -1));

  const support = Number(recentLow.toFixed(2));
  const resistance = Number(recentHigh.toFixed(2));

  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / Math.max(volumes.length, 1);
  const rvol = Number((volume / Math.max(avgVolume, 1)).toFixed(2));
  const volumeSpike = rvol >= 1.5;

  const dollarVolume = Number((price * volume).toFixed(0));

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const atr = calculateATR(candles, 14);
  const oldATR = candles.length > 25 ? calculateATR(candles.slice(0, -5), 14) : atr;
  const atrExpansion = atr > oldATR * 1.15;

  const bb = bollingerBands(closes, 20, 2);

  const bullishTrend = ema9 > ema21 && price > ema9;
  const above50 = ema50 ? price > ema50 : false;
  const above200 = ema200 ? price > ema200 : false;

  const relativeStrength = Number((change - spyChange).toFixed(2));
  const nearResistance = resistance > 0 ? ((resistance - price) / price) * 100 <= 1.5 : false;
  const nearSupport = support > 0 ? ((price - support) / price) * 100 <= 2 : false;

  const hasNewsCatalyst = news.length > 0;
  const newsTitle = news[0]?.title || '';

  const pattern =
    nearResistance && bullishTrend && volumeSpike
      ? 'High volume breakout setup'
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

  let score = 0;

  if (bullishTrend) score += 15;
  if (above50) score += 8;
  if (above200) score += 8;
  if (relativeStrength > 1) score += 12;
  if (rvol >= 2) score += 12;
  else if (rvol >= 1.5) score += 8;
  if (nearResistance || nearSupport) score += 10;
  if (pattern.includes('setup')) score += 12;
  if (bb.aboveMiddle) score += 5;
  if (bb.nearUpper && bullishTrend) score += 5;
  if (bb.squeeze && bullishTrend) score += 5;
  if (hasNewsCatalyst) score += 10;
  if (dollarVolume > 1000000000) score += 10;
  else if (dollarVolume > 500000000) score += 7;
  else if (dollarVolume > 100000000) score += 4;
  if (atrExpansion) score += 8;
  if (ticker === 'SPY' || ticker === 'QQQ') score += 5;

  score = Math.min(99, Math.round(score));

  const buffer = Math.max(atr * 0.1, price * 0.001);

  let entry = null;
  let stop = null;

  if (pattern === 'High volume breakout setup' || pattern === 'Breakout setup') {
    entry = Number((resistance + buffer).toFixed(2));
    stop = Number((Math.min(support - buffer, entry - atr * 1.2)).toFixed(2));
  } else if (pattern === 'Support bounce setup') {
    entry = Number((Math.max(price, highs.at(-1)) + buffer).toFixed(2));
    stop = Number((support - buffer).toFixed(2));
  } else if (pattern === 'Momentum continuation' || pattern === 'Bollinger squeeze bullish') {
    entry = Number((highs.at(-1) + buffer).toFixed(2));
    stop = Number((Math.max(ema21 - buffer, price - atr * 1.5)).toFixed(2));
  }

  let t1 = null, t2 = null, rr = null, pctToEntry = null;

  if (entry && stop && entry > stop) {
    const risk = entry - stop;
    t1 = Number((entry + risk * 2).toFixed(2));
    t2 = Number((entry + risk * 3).toFixed(2));
    rr = 2;
    pctToEntry = Number((((entry - price) / price) * 100).toFixed(2));
  }

  const status =
    !entry ? 'No Setup' :
    pctToEntry <= 1 ? 'Alert' :
    pctToEntry <= 3 ? 'Watch' :
    'Waiting';

  return {
    ticker,
    sector: sectorMap[ticker] || 'Other',
    score,
    price,
    change,
    volumeRank: Math.ceil(Math.random() * 100),
    entry,
    stop,
    t1,
    t2,
    rr,
    pctToEntry,
    support,
    resistance,
    pattern,
    analysis: `Support $${support} | Resistance $${resistance} | Pattern: ${pattern}`,
    bullishTrend,
    volumeSpike,
    rvol,
    relativeStrength,
    dollarVolume,
    atr,
    atrExpansion,
    bollinger: bb,
    hasNewsCatalyst,
    newsTitle,
    status,
    spark: spark && spark.length ? spark : []
  };
}

function ema(values, period) {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
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
    return { upper: 0, middle: 0, lower: 0, width: 0, squeeze: false, aboveMiddle: false, nearUpper: false };
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

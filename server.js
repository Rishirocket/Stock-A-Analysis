import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY =
  process.env.MASSIVE_API_KEY ||
  process.env.POLYGON_API_KEY ||
  '';

async function polygon(pathname) {
  if (!API_KEY) {
    throw new Error('Missing MASSIVE_API_KEY or POLYGON_API_KEY in Railway Variables');
  }

  const url = `https://api.polygon.io${pathname}${
    pathname.includes('?') ? '&' : '?'
  }apiKey=${API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Polygon/Massive API error ${response.status}`);
  }

  return response.json();
}

const symbols = [
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','AVGO','TSLA',
  'JPM','LLY','V','MA','UNH','XOM','COST','NFLX','HD','PG',
  'ABBV','CRM','AMD','QCOM','ORCL','BAC','KO','PEP','CSCO',
  'WMT','MCD','ADBE','IBM','GE','CAT','GS','INTC','MRK',
  'DIS','TMO','AMGN','TXN','RGTI','SOUN','NEE','TE','SOFI','HIMS',
  'IONQ','QBTS','RKLB','ASTS','PLTR','MU','SMCI','ARM','CRWD','APP'
];

function timeframeToPolygon(tf) {
  switch (tf) {
    case '5M':
      return { multiplier: 5, timespan: 'minute', daysBack: 3 };
    case '15M':
      return { multiplier: 15, timespan: 'minute', daysBack: 5 };
    case '1H':
      return { multiplier: 1, timespan: 'hour', daysBack: 10 };
    case '1W':
      return { multiplier: 1, timespan: 'week', daysBack: 365 };
    case '1D':
    default:
      return { multiplier: 1, timespan: 'day', daysBack: 90 };
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
      return res.json({
        live: false,
        timeframe,
        message: 'Add MASSIVE_API_KEY in Railway Variables to enable live data.',
        stocks: demoStocks(timeframe)
      });
    }

    const tickers = (req.query.tickers || symbols.join(','))
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 100);

    const from = dateAgo(tf.daysBack);
    const to = new Date().toISOString().slice(0, 10);

    const out = [];

    for (const ticker of tickers.slice(0, 60)) {
      try {
        const data = await polygon(
          `/v2/aggs/ticker/${ticker}/range/${tf.multiplier}/${tf.timespan}/${from}/${to}?adjusted=true&sort=desc&limit=50`
        );

        const candles = data.results || [];
        if (!candles.length) continue;

        const latest = candles[0];
        const previous = candles[1] || latest;

        const price = Number(latest.c.toFixed(2));
        const change = Number((((latest.c - previous.c) / previous.c) * 100).toFixed(2));

        const orderedCandles = candles.slice().reverse();

        const spark = orderedCandles.map(c => Number(c.c.toFixed(2)));

        out.push(
          makeStock(
            ticker,
            price,
            change,
            latest.v,
            spark,
            timeframe,
            orderedCandles
          )
        );
      } catch (e) {
        console.error(`Failed ${ticker}`, e.message);
      }
    }

    const sorted = out.length ? out.sort((a, b) => b.score - a.score) : demoStocks(timeframe);

    res.json({
      live: true,
      timeframe,
      stocks: sorted
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

function makeStock(ticker, price, change, volume, spark, timeframe = '1H', candles = []) {
  const sectorMap = {
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

  const recentHigh = Math.max(...highs.slice(-20));
  const recentLow = Math.min(...lows.slice(-20));

  const support = Number(recentLow.toFixed(2));
  const resistance = Number(recentHigh.toFixed(2));

  const avgVolume =
    volumes.reduce((sum, v) => sum + v, 0) / Math.max(volumes.length, 1);

  const volumeSpike = volume > avgVolume * 1.5;

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);

  const bullishTrend = ema9 > ema21 && price > ema9;

  const nearResistance =
    resistance > 0 ? ((resistance - price) / price) * 100 <= 1.5 : false;

  const pattern =
    nearResistance && bullishTrend
      ? 'Breakout setup'
      : bullishTrend && volumeSpike
      ? 'Momentum continuation'
      : price <= support * 1.02
      ? 'Support bounce watch'
      : change < -1.5
      ? 'Pullback / wait'
      : 'Consolidation';

  let score = 70;
  if (bullishTrend) score += 10;
  if (nearResistance) score += 8;
  if (volumeSpike) score += 7;
  if (change > 0) score += 4;
  if (price > support && price < resistance) score += 3;
  score = Math.min(99, score);

  const entry =
    pattern === 'Breakout setup'
      ? Number((resistance * 1.002).toFixed(2))
      : Number((price * 1.012).toFixed(2));

  const stop =
    pattern === 'Support bounce watch'
      ? Number((support * 0.995).toFixed(2))
      : Number((Math.max(support * 0.995, price * 0.985)).toFixed(2));

  const risk = Math.max(entry - stop, price * 0.005);

  const t1 = Number((entry + risk * 2.1).toFixed(2));
  const t2 = Number((entry + risk * 3.5).toFixed(2));

  const rr = Number(((t1 - entry) / risk).toFixed(1));

  const pctToEntry = Number((((entry - price) / price) * 100).toFixed(2));

  const status =
    pctToEntry <= 1
      ? 'Alert'
      : pctToEntry <= 3
      ? 'Watch'
      : 'Waiting';

  const analysis =
    `Support $${support} | Resistance $${resistance} | Pattern: ${pattern}`;

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
    analysis,
    bullishTrend,
    volumeSpike,
    status,
    spark: spark && spark.length ? spark : Array.from(
      { length: 12 },
      () => Number((price * (0.97 + Math.random() * 0.06)).toFixed(2))
    )
  };
}

function ema(values, period) {
  if (!values.length) return 0;

  const k = 2 / (period + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
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

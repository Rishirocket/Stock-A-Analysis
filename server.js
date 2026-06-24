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
    throw new Error(
      'Missing MASSIVE_API_KEY or POLYGON_API_KEY in Railway Variables'
    );
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
  'DIS','TMO','AMGN','TXN','RGTI','SOUN','NEE','TE','SOFI','HIMS'
];

app.get('/api/stocks', async (req, res) => {
  try {
    if (!API_KEY) {
      return res.json({
        live: false,
        message:
          'Add MASSIVE_API_KEY in Railway Variables to enable live data.',
        stocks: demoStocks()
      });
    }

    const tickers = (
      req.query.tickers || symbols.join(',')
    ).split(',').slice(0, 100);

    const out = [];

    for (const ticker of tickers.slice(0, 60)) {
      try {
        const prev = await polygon(
          `/v2/aggs/ticker/${ticker}/prev?adjusted=true`
        );

        const r = prev.results?.[0];

        if (!r) continue;

        const price = Number(r.c.toFixed(2));
        const change = Number(
          (((r.c - r.o) / r.o) * 100).toFixed(2)
        );

        out.push(
          makeStock(
            ticker,
            price,
            change,
            r.v
          )
        );
      } catch (e) {
        console.error(`Failed ${ticker}`, e.message);
      }
    }

    res.json({
      live: true,
      stocks: out.length ? out : demoStocks()
    });
  } catch (err) {
    res.status(500).json({
      live: false,
      error: err.message,
      stocks: demoStocks()
    });
  }
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('/*splat', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'dist', 'index.html')
  );
});

app.listen(PORT, () => {
  console.log(`A+ Stocks running on port ${PORT}`);
});

function makeStock(ticker, price, change, volume) {
  const sectors = [
    'Technology',
    'Healthcare',
    'Financials',
    'Consumer',
    'Energy',
    'Industrials'
  ];

  const score = 70 + Math.floor(Math.random() * 30);

  const entry = +(
    price *
    (1 + Math.random() * 0.025)
  ).toFixed(2);

  const stop = +(price * 0.985).toFixed(2);

  const t1 = +(
    entry +
    (entry - stop) * 2.1
  ).toFixed(2);

  const t2 = +(
    entry +
    (entry - stop) * 3.5
  ).toFixed(2);

  const rr = +(
    (t1 - entry) /
    (entry - stop)
  ).toFixed(1);

  const pctToEntry = +(
    ((entry - price) / price) * 100
  ).toFixed(2);

  return {
    ticker,
    sector:
      sectors[
        Math.floor(
          Math.random() * sectors.length
        )
      ],
    score,
    price,
    change,
    volumeRank: Math.ceil(
      Math.random() * 100
    ),
    entry,
    stop,
    t1,
    t2,
    rr,
    pctToEntry,
    status:
      pctToEntry < 1
        ? 'Alert'
        : 'Watch',
    spark: Array.from(
      { length: 12 },
      () =>
        +(
          price *
          (0.97 + Math.random() * 0.06)
        ).toFixed(2)
    )
  };
}

function demoStocks() {
  return symbols.map((s, i) =>
    makeStock(
      s,
      80 + Math.random() * 420,
      -2 + Math.random() * 5,
      1000000 + i
    )
  );
}

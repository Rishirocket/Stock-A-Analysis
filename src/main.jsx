import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

function grade(score){ return score>=90?'A+':score>=80?'A':score>=70?'B':'C'; }
function rrClass(rr){ return rr>=2?'good':rr>=1.5?'watch':'bad'; }
function pctClass(p){ return p<=1?'near':p<=3?'mid':'far'; }
function fmt(n){ return n==null || Number.isNaN(Number(n)) ? '-' : Number(n).toLocaleString(); }
function money(n){ return n==null ? '-' : `$${Number(n).toFixed(2)}`; }

function Spark({data=[]}){
  if(!data.length) return null;
  const min=Math.min(...data), max=Math.max(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*100},${34-((v-min)/range)*28}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 40"><polyline points={pts}/></svg>
}

function App(){
  const [stocks,setStocks]=useState([]);
  const [q,setQ]=useState('');
  const [view,setView]=useState('grid');
  const [rrOnly,setRrOnly]=useState(false);
  const [live,setLive]=useState(false);
  const [timeframe,setTimeframe]=useState('1H');
  const [loading,setLoading]=useState(false);
  const [scoreSort,setScoreSort]=useState('desc');
  const [selectedStock,setSelectedStock]=useState(null);

  useEffect(()=>{
    setLoading(true);
    fetch(`/api/stocks?timeframe=${timeframe}`)
      .then(r=>r.json())
      .then(d=>{
        setStocks(d.stocks||[]);
        setLive(!!d.live);
      })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[timeframe]);

  const filtered=useMemo(()=>{
    const search=q.trim().toLowerCase();

    return stocks
      .filter(s=>
        (!search ||
          String(s.ticker || '').toLowerCase().includes(search) ||
          String(s.sector || '').toLowerCase().includes(search)
        ) && (!rrOnly || Number(s.rr)>=2)
      )
      .sort((a,b)=>scoreSort==='desc'
        ? Number(b.score)-Number(a.score)
        : Number(a.score)-Number(b.score)
      );
  },[stocks,q,rrOnly,scoreSort]);

  const exportCsv=()=>{
    const cols=[
      'ticker','score','price','pctToEntry','entry','stop','t1','t2',
      'rr','sector','status','support','resistance','pattern','rvol',
      'avgVolume','currentVolume','relativeStrength','atr','atrExpansion',
      'newsTitle','analysis'
    ];
    const csv=[cols.join(','),...filtered.map(s=>cols.map(c=>`"${s[c] ?? ''}"`).join(','))].join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`a-plus-stocks-${timeframe}.csv`;
    a.click();
  };

  return <main>
    <header className="hero">
      <div>
        <p className="eyebrow">
          {live?'LIVE POLYGON/MASSIVE DATA':'DEMO DATA - ADD API KEY IN RAILWAY'} • TIMEFRAME {timeframe}
        </p>
        <h1>A+ Stocks</h1>
        <p>Premium screener with real setup-based entries, support, resistance, RVOL, ATR, Bollinger Bands and news catalyst.</p>
      </div>
      <button onClick={exportCsv}>Export CSV</button>
    </header>

    <section className="toolbar">
      <input placeholder="Search ticker or sector, example: rgti" value={q} onChange={e=>setQ(e.target.value)}/>

      <div className="timeframes">
        {['5M','15M','1H','1D','1W'].map(tf=>(
          <button key={tf} className={timeframe===tf?'active':''} onClick={()=>setTimeframe(tf)}>
            {tf}
          </button>
        ))}
      </div>

      <button className={rrOnly?'active':''} onClick={()=>setRrOnly(!rrOnly)}>R:R &gt; 2:1</button>
      <button>Score 80-100</button>
      <button>Volume Spike</button>
      <button>Near Breakout</button>

      <div className="toggle">
        <button className={view==='grid'?'active':''} onClick={()=>setView('grid')}>Grid</button>
        <button className={view==='table'?'active':''} onClick={()=>setView('table')}>Table</button>
      </div>
    </section>

    {loading && <p className="loading">Loading {timeframe} data...</p>}

    {view==='grid'
      ? <div className="grid">{filtered.map(s=><Card key={s.ticker} s={s} onViewPlan={setSelectedStock}/>)}</div>
      : <Table rows={filtered} scoreSort={scoreSort} setScoreSort={setScoreSort} onViewPlan={setSelectedStock}/>
    }

    {selectedStock && <PlanModal s={selectedStock} onClose={()=>setSelectedStock(null)}/>}
  </main>
}

function Card({s,onViewPlan}){
  return <article className={`card ${s.pctToEntry!=null && s.pctToEntry<=1?'pulse':''}`}>
    <div className="cardTop">
      <div>
        <h2>{s.ticker}</h2>
        <span>{s.sector}</span>
      </div>
      <b className={`badge g${grade(s.score).replace('+','p')}`}>{grade(s.score)} {s.score}</b>
    </div>

    <div className="price">
      <strong>{money(s.price)}</strong>
      <em className={s.change>=0?'up':'down'}>{s.change>=0?'+':''}{s.change}%</em>
    </div>

    <Spark data={s.spark}/>

    <div className="checks">
      <p>{s.bullishTrend ? '✓' : '×'} Bullish trend <span>EMA9 {s.ema9} / EMA21 {s.ema21}</span></p>
      <p>{s.above50 ? '✓' : '×'} Above 50 EMA <span>{s.ema50}</span></p>
      <p>{s.above200 ? '✓' : '×'} Above 200 EMA <span>{s.ema200}</span></p>
      <p>{s.volumeSpike ? '✓' : '×'} Volume spike <span>RVOL {s.rvol}x / Avg Vol {fmt(s.avgVolume)}</span></p>
      <p>{s.pctToEntry!=null && s.pctToEntry<=1?'✓':'×'} Near breakout <span>{s.pctToEntry ?? '-'}%</span></p>
    </div>

    <div className={`plan ${rrClass(s.rr || 0)}`}>
      Entry: {money(s.entry)} | Stop: {money(s.stop)} | T1: {money(s.t1)} | T2: {money(s.t2)} | R:R {s.rr ?? '-'}:1
    </div>

    <div className="analysis">
      <strong>Quick Analysis</strong><br/>
      Support: {money(s.support)} | Resistance: {money(s.resistance)}<br/>
      Pattern: {s.pattern ?? 'Checking pattern'}<br/>
      News: {s.hasNewsCatalyst ? 'Yes' : 'No'} {s.newsTitle ? `• ${s.newsTitle}` : ''}
    </div>

    <footer>
      <span className={s.pctToEntry!=null && s.pctToEntry<=1?'hot':''}>{s.status || 'Watch'}</span>
      <button onClick={()=>onViewPlan(s)}>View Plan</button>
    </footer>
  </article>
}

function PlanModal({s,onClose}){
  const breakdown = s.scoreBreakdown || {};

  return <div className="modalOverlay">
    <div className="modalCard">
      <div className="modalTop">
        <div>
          <p className="eyebrow">FULL TRADE ANALYSIS</p>
          <h2>{s.ticker} • {grade(s.score)} {s.score}/100</h2>
          <span>{s.sector} • {s.status}</span>
        </div>
        <button onClick={onClose}>Close</button>
      </div>

      <div className="modalGrid">
        <section>
          <h3>Trade Plan</h3>
          <p>Entry: <b>{money(s.entry)}</b></p>
          <p>Stop: <b>{money(s.stop)}</b></p>
          <p>Target 1: <b>{money(s.t1)}</b></p>
          <p>Target 2: <b>{money(s.t2)}</b></p>
          <p>R:R: <b>{s.rr ?? '-'}:1</b></p>
          <p>% to Entry: <b>{s.pctToEntry ?? '-'}%</b></p>
        </section>

        <section>
          <h3>Price Structure</h3>
          <p>Current Price: <b>{money(s.price)}</b></p>
          <p>Support: <b>{money(s.support)}</b></p>
          <p>Resistance: <b>{money(s.resistance)}</b></p>
          <p>Pattern: <b>{s.pattern}</b></p>
          <p>Relative Strength vs SPY: <b>{s.relativeStrength}%</b></p>
        </section>

        <section>
          <h3>EMA Trend</h3>
          <p>Bullish Trend: <b>{s.bullishTrend ? 'YES' : 'NO'}</b></p>
          <p>EMA 9: <b>{s.ema9}</b></p>
          <p>EMA 21: <b>{s.ema21}</b></p>
          <p>EMA 50: <b>{s.ema50}</b></p>
          <p>EMA 200: <b>{s.ema200}</b></p>
        </section>

        <section>
          <h3>Volume / Liquidity</h3>
          <p>RVOL: <b>{s.rvol}x</b></p>
          <p>Average Volume: <b>{fmt(s.avgVolume)}</b></p>
          <p>Current Volume: <b>{fmt(s.currentVolume)}</b></p>
          <p>Dollar Volume: <b>${fmt(s.dollarVolume)}</b></p>
          <p>Volume Spike: <b>{s.volumeSpike ? 'YES' : 'NO'}</b></p>
        </section>

        <section>
          <h3>ATR / Volatility</h3>
          <p>ATR: <b>{s.atr}</b></p>
          <p>ATR Expansion: <b>{s.atrExpansion ? 'YES' : 'NO'}</b></p>
        </section>

        <section>
          <h3>Bollinger Bands</h3>
          <p>Upper: <b>{s.bollinger?.upper ?? '-'}</b></p>
          <p>Middle: <b>{s.bollinger?.middle ?? '-'}</b></p>
          <p>Lower: <b>{s.bollinger?.lower ?? '-'}</b></p>
          <p>Width: <b>{s.bollinger?.width ?? '-'}%</b></p>
          <p>Squeeze: <b>{s.bollinger?.squeeze ? 'YES' : 'NO'}</b></p>
        </section>

        <section className="wide">
          <h3>News Catalyst</h3>
          <p>News Catalyst: <b>{s.hasNewsCatalyst ? 'YES +10' : 'NO'}</b></p>
          <p>{s.newsTitle || 'No recent catalyst found from Polygon news.'}</p>
        </section>

        <section className="wide">
          <h3>Score Breakdown</h3>
          <div className="scoreBreakdown">
            {Object.entries(breakdown).map(([k,v])=>(
              <p key={k}><span>{k}</span><b>+{v}</b></p>
            ))}
          </div>
        </section>
      </div>
    </div>
  </div>
}

function Table({rows,scoreSort,setScoreSort,onViewPlan}){
  const toggleScoreSort=()=>setScoreSort(scoreSort==='desc'?'asc':'desc');

  return <div className="tableWrap">
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Ticker</th>
          <th className="sortable" onClick={toggleScoreSort}>Score {scoreSort==='desc'?'↓':'↑'}</th>
          <th>Price</th>
          <th>% to Entry</th>
          <th>Entry</th>
          <th>Stop</th>
          <th>T1</th>
          <th>T2</th>
          <th>R:R</th>
          <th>RVOL</th>
          <th>Rel Str</th>
          <th>Support</th>
          <th>Resistance</th>
          <th>Pattern</th>
          <th>Sector</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s,i)=>
          <tr key={s.ticker}>
            <td>{i+1}</td>
            <td><b>{s.ticker}</b></td>
            <td><span className={`badge g${grade(s.score).replace('+','p')}`}>{grade(s.score)} {s.score}</span></td>
            <td>{money(s.price)}</td>
            <td className={pctClass(s.pctToEntry ?? 999)}>{s.pctToEntry ?? '-'}%</td>
            <td>{money(s.entry)}</td>
            <td>{money(s.stop)}</td>
            <td>{money(s.t1)}</td>
            <td>{money(s.t2)}</td>
            <td>{s.rr ?? '-'}:1</td>
            <td>{s.rvol ?? '-'}x</td>
            <td>{s.relativeStrength ?? '-'}%</td>
            <td>{money(s.support)}</td>
            <td>{money(s.resistance)}</td>
            <td>{s.pattern ?? '-'}</td>
            <td>{s.sector}</td>
            <td><span className="status">{s.status}</span></td>
            <td><button onClick={()=>onViewPlan(s)}>View</button></td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);

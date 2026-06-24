import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

function grade(score){ return score>=90?'A+':score>=80?'A':score>=70?'B':'C'; }
function rrClass(rr){ return rr>=2?'good':rr>=1.5?'watch':'bad'; }
function pctClass(p){ return p<=1?'near':p<=3?'mid':'far'; }

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
      'rr','volumeRank','sector','status','support','resistance','pattern','analysis'
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
        <p>Premium S&P 500 screener with entry, stop, targets, support, resistance and R:R plans.</p>
      </div>
      <button onClick={exportCsv}>Export CSV</button>
    </header>

    <section className="toolbar">
      <input placeholder="Search ticker or sector, example: rgti" value={q} onChange={e=>setQ(e.target.value)}/>

      <div className="timeframes">
        {['5M','15M','1H','1D','1W'].map(tf=>(
          <button
            key={tf}
            className={timeframe===tf?'active':''}
            onClick={()=>setTimeframe(tf)}
          >
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
      ? <div className="grid">{filtered.map(s=><Card key={s.ticker} s={s}/>)}</div>
      : <Table rows={filtered} scoreSort={scoreSort} setScoreSort={setScoreSort}/>
    }
  </main>
}

function Card({s}){
  return <article className={`card ${s.pctToEntry<=1?'pulse':''}`}>
    <div className="cardTop">
      <div>
        <h2>{s.ticker}</h2>
        <span>{s.sector}</span>
      </div>
      <b className={`badge g${grade(s.score).replace('+','p')}`}>{grade(s.score)} {s.score}</b>
    </div>

    <div className="price">
      <strong>${s.price}</strong>
      <em className={s.change>=0?'up':'down'}>{s.change>=0?'+':''}{s.change}%</em>
    </div>

    <Spark data={s.spark}/>

    <div className="checks">
      <p>{s.bullishTrend ? '✓' : '×'} Bullish trend</p>
      <p>{s.bullishTrend ? '✓' : '×'} Above 9/21 EMA</p>
      <p>✓ Support below price</p>
      <p>{s.volumeSpike ? '✓' : '×'} Volume spike</p>
      <p>{s.pctToEntry<=1?'✓':'×'} Near breakout</p>
    </div>

    <div className={`plan ${rrClass(s.rr)}`}>
      Entry: ${s.entry} | Stop: ${s.stop} | T1: ${s.t1} | T2: ${s.t2} | R:R {s.rr}:1
    </div>

    <div className="analysis">
      <strong>Chart Analysis</strong><br/>
      Support: ${s.support ?? '-'} | Resistance: ${s.resistance ?? '-'}<br/>
      Pattern: {s.pattern ?? 'Checking pattern'}
    </div>

    <footer>
      <span className={s.pctToEntry<=1?'hot':''}>{s.status || 'Watch'}</span>
      <button>View Plan</button>
    </footer>
  </article>
}

function Table({rows,scoreSort,setScoreSort}){
  const toggleScoreSort=()=>{
    setScoreSort(scoreSort==='desc'?'asc':'desc');
  };

  return <div className="tableWrap">
    <table>
      <thead>
        <tr>
          <th>Rank</th>
          <th>Ticker</th>
          <th className="sortable" onClick={toggleScoreSort}>
            Score {scoreSort==='desc'?'↓':'↑'}
          </th>
          <th>Price</th>
          <th>% to Entry</th>
          <th>Entry</th>
          <th>Stop</th>
          <th>T1</th>
          <th>T2</th>
          <th>R:R</th>
          <th>Support</th>
          <th>Resistance</th>
          <th>Pattern</th>
          <th>Volume Rank</th>
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
            <td>${s.price}</td>
            <td className={pctClass(s.pctToEntry)}>{s.pctToEntry}%</td>
            <td>${s.entry}</td>
            <td>${s.stop}</td>
            <td>${s.t1}</td>
            <td>${s.t2}</td>
            <td>{s.rr}:1</td>
            <td>${s.support ?? '-'}</td>
            <td>${s.resistance ?? '-'}</td>
            <td>{s.pattern ?? '-'}</td>
            <td>{s.volumeRank}</td>
            <td>{s.sector}</td>
            <td><span className="status">{s.status}</span></td>
            <td><button>Alert</button></td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);

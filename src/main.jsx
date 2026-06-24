import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';

function grade(score){ return score>=90?'A+':score>=80?'A':score>=70?'B':'C'; }
function rrClass(rr){ return rr>=2?'good':rr>=1.5?'watch':'bad'; }
function pctClass(p){ return p<=1?'near':p<=3?'mid':'far'; }

function Spark({data=[]}){
  const min=Math.min(...data), max=Math.max(...data), range=max-min||1;
  const pts=data.map((v,i)=>`${(i/(data.length-1))*100},${34-((v-min)/range)*28}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 40"><polyline points={pts}/></svg>
}
function App(){
  const [stocks,setStocks]=useState([]), [q,setQ]=useState(''), [view,setView]=useState('grid'), [rrOnly,setRrOnly]=useState(false), [live,setLive]=useState(false);
  useEffect(()=>{ fetch('/api/stocks').then(r=>r.json()).then(d=>{setStocks(d.stocks||[]);setLive(!!d.live)}).catch(()=>{}); },[]);
  const filtered=useMemo(()=>stocks.filter(s=>(!q||s.ticker.toLowerCase().includes(q.toLowerCase())||s.sector.toLowerCase().includes(q.toLowerCase())) && (!rrOnly||s.rr>=2)),[stocks,q,rrOnly]);
  const exportCsv=()=>{const cols=['ticker','score','price','pctToEntry','entry','stop','t1','t2','rr','volumeRank','sector','status']; const csv=[cols.join(','),...filtered.map(s=>cols.map(c=>s[c]).join(','))].join('\n'); const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='a-plus-stocks.csv';a.click();};
  return <main>
    <header className="hero"><div><p className="eyebrow">{live?'LIVE POLYGON/MASSIVE DATA':'DEMO DATA - ADD API KEY IN RAILWAY'}</p><h1>A+ Stocks</h1><p>Premium S&P 500 screener with entry, stop, targets and R:R plans.</p></div><button onClick={exportCsv}>Export CSV</button></header>
    <section className="toolbar"><input placeholder="Search ticker or sector" value={q} onChange={e=>setQ(e.target.value)}/><button className={rrOnly?'active':''} onClick={()=>setRrOnly(!rrOnly)}>R:R &gt; 2:1</button><button>Score 80-100</button><button>Volume Spike</button><button>Near Breakout</button><div className="toggle"><button className={view==='grid'?'active':''} onClick={()=>setView('grid')}>Grid</button><button className={view==='table'?'active':''} onClick={()=>setView('table')}>Table</button></div></section>
    {view==='grid'?<div className="grid">{filtered.map(s=><Card key={s.ticker} s={s}/>)}</div>:<Table rows={filtered}/>} 
  </main>
}
function Card({s}){return <article className={`card ${s.pctToEntry<=1?'pulse':''}`}><div className="cardTop"><div><h2>{s.ticker}</h2><span>{s.sector}</span></div><b className={`badge g${grade(s.score).replace('+','p')}`}>{grade(s.score)} {s.score}</b></div><div className="price"><strong>${s.price}</strong><em className={s.change>=0?'up':'down'}>{s.change>=0?'+':''}{s.change}%</em></div><Spark data={s.spark}/><div className="checks"><p>✓ Bullish trend</p><p>✓ Above 9/21 EMA</p><p>✓ POC below price</p><p>{s.volumeRank<50?'✓':'×'} Volume &gt; 2x avg</p><p>{s.pctToEntry<=1?'✓':'×'} Near breakout</p></div><div className={`plan ${rrClass(s.rr)}`}>Entry: ${s.entry} | Stop: ${s.stop} | T1: ${s.t1} | T2: ${s.t2} | R:R {s.rr}:1</div><footer><span className={s.pctToEntry<=1?'hot':''}>{s.pctToEntry<=1?'Near Breakout':'Watch'}</span><button>View Plan</button></footer></article>}
function Table({rows}){return <div className="tableWrap"><table><thead><tr>{['Rank','Ticker','Score','Price','% to Entry','Entry','Stop','T1','T2','R:R','Volume Rank','Sector','Status','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((s,i)=><tr key={s.ticker}><td>{i+1}</td><td><b>{s.ticker}</b></td><td><span className={`badge g${grade(s.score).replace('+','p')}`}>{grade(s.score)} {s.score}</span></td><td>${s.price}</td><td className={pctClass(s.pctToEntry)}>{s.pctToEntry}%</td><td>${s.entry}</td><td>${s.stop}</td><td>${s.t1}</td><td>${s.t2}</td><td>{s.rr}:1</td><td>{s.volumeRank}</td><td>{s.sector}</td><td><span className="status">{s.status}</span></td><td><button>Alert</button></td></tr>)}</tbody></table></div>}

createRoot(document.getElementById('root')).render(<App/>);

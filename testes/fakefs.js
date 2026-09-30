'use strict';
// Firestore falso em memoria: so o que o lib/checkout.js usa.
class Timestamp { constructor(ms){this._ms=ms;} toMillis(){return this._ms;} static fromMillis(ms){return new Timestamp(ms);} static now(){return new Timestamp(Date.now());} }
const S_TS={s:'ts'}, S_DEL={s:'del'};
class Inc{constructor(n){this.n=n;}}
const FieldValue={ serverTimestamp:()=>S_TS, delete:()=>S_DEL, increment:(n)=>new Inc(n) };
const store=new Map(); // path -> data
let seq=0;
function rid(){ seq++; return ('X'+seq+'abcdefghijklmnopqrstu').slice(0,20); }
function isPlain(o){return o&&typeof o==='object'&&!Array.isArray(o)&&!(o instanceof Timestamp)&&!(o instanceof Inc)&&o!==S_TS&&o!==S_DEL;}
function clone(v){ if(v instanceof Timestamp)return v; if(Array.isArray(v))return v.map(clone); if(isPlain(v)){const o={};for(const k in v)o[k]=clone(v[k]);return o;} return v; }
function resolve(cur,v){ if(v===S_TS)return Timestamp.now(); if(v instanceof Inc)return (typeof cur==='number'?cur:0)+v.n; if(Array.isArray(v))return v.map(x=>resolve(undefined,x)); if(isPlain(v)){const o={};for(const k in v){const r=resolve(undefined,v[k]); if(v[k]!==S_DEL)o[k]=r;}return o;} return v; }
function deepMerge(base,v){ const o=isPlain(base)?clone(base):{}; for(const k in v){ const x=v[k]; if(x===S_DEL){delete o[k];continue;} if(isPlain(x)) o[k]=deepMerge(o[k],x); else o[k]=resolve(o[k],x);} return o; }
function setPath(o,path,val){ const ps=path.split('.'); let c=o; for(let i=0;i<ps.length-1;i++){ if(!isPlain(c[ps[i]]))c[ps[i]]={}; c=c[ps[i]]; } const last=ps[ps.length-1]; if(val===S_DEL)delete c[last]; else c[last]=resolve(c[last],val); }
function getPath(o,path){ return path.split('.').reduce((c,k)=>c==null?undefined:c[k],o); }
function applySet(path,data,opts){ const cur=store.get(path);
  if(opts&&opts.mergeFields){ const o=cur?clone(cur):{}; for(const f of opts.mergeFields){ const v=data[f]; if(v===undefined||v===S_DEL)delete o[f]; else o[f]=resolve(undefined,v);} store.set(path,o); return; }
  if(opts&&opts.merge){ store.set(path,deepMerge(cur,data)); return; }
  store.set(path,resolve(undefined,data)); }
function applyUpdate(path,data){ const cur=store.get(path); if(!cur){const e=new Error('NOT_FOUND '+path);e.code=5;throw e;} const o=clone(cur); for(const k in data)setPath(o,k,data[k]); store.set(path,o); }
class Snap{ constructor(ref){this.ref=ref;this.id=ref.id;const d=store.get(ref.path);this.exists=!!d;this._d=d?clone(d):undefined;} data(){return this._d;} get(f){return this._d?getPath(this._d,f):undefined;} }
class DocRef{ constructor(path){this.path=path;this.id=path.split('/').pop();}
  collection(n){return new ColRef(this.path+'/'+n);}
  async get(){return new Snap(this);} async set(d,o){applySet(this.path,d,o);} async update(d){applyUpdate(this.path,d);} async delete(){store.delete(this.path);} }
function cmp(a,b){ const va=a instanceof Timestamp?a.toMillis():a, vb=b instanceof Timestamp?b.toMillis():b; return va<vb?-1:va>vb?1:0; }
class Query{ constructor(col,filters,lim,ord){this.col=col;this.f=filters||[];this.l=lim;this.o=ord;}
  where(f,op,v){return new Query(this.col,this.f.concat([[f,op,v]]),this.l,this.o);} limit(n){return new Query(this.col,this.f,n,this.o);} orderBy(f){return new Query(this.col,this.f,this.l,f);}
  async get(){ const pre=this.col+'/'; let docs=[]; for(const [p,d] of store){ if(!p.startsWith(pre)||p.slice(pre.length).includes('/'))continue;
      let ok=true; for(const [f,op,v] of this.f){ const x=getPath(d,f); if(x===undefined){ok=false;break;} const c=cmp(x,v); if(op==='=='&&c!==0)ok=false; if(op==='<='&&c>0)ok=false; if(op==='>'&&c<=0)ok=false; if(op==='>='&&c<0)ok=false; if(op==='<'&&c>=0)ok=false; if(op==='in'&&v.indexOf(x)<0)ok=false; if(!ok)break;}
      if(ok)docs.push(new Snap(new DocRef(p))); }
    if(this.o)docs.sort((a,b)=>cmp(getPath(a.data(),this.o),getPath(b.data(),this.o)));
    if(this.l)docs=docs.slice(0,this.l); return {size:docs.length,docs,empty:!docs.length,forEach:(fn)=>docs.forEach(fn)}; } }
class ColRef extends Query{ constructor(path){super(path);this.path=path;} doc(id){return new DocRef(this.path+'/'+(id||rid()));} async add(d){const r=this.doc();applySet(r.path,d);return r;} }
const db={ collection:(n)=>new ColRef(n), async runTransaction(fn){ for(let t=0;t<3;t++){ const writes=[]; let escreveu=false;
      const tx={ async get(r){ if(escreveu)throw new Error('leitura depois de escrita na transacao'); return new Snap(r);},
        set(r,d,o){escreveu=true;writes.push(()=>applySet(r.path,d,o));}, update(r,d){escreveu=true;writes.push(()=>applyUpdate(r.path,d));}, delete(r){escreveu=true;writes.push(()=>store.delete(r.path));} };
      const out=await fn(tx); const snap=new Map(store); try{ writes.forEach(w=>w()); }catch(e){ store.clear(); for(const [k,v] of snap)store.set(k,v); throw e; } return out; } } };
const admin={ firestore:Object.assign(()=>db,{FieldValue,Timestamp}), auth:()=>({getUser:async()=>{throw new Error('sem auth');},verifyIdToken:async(t)=>({uid:t})}), storage:()=>({bucket:()=>({})}) };
module.exports={admin,db,store,Timestamp};

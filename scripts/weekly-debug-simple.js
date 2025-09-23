const fs = require('fs');

function pad(n){ return n<10? '0'+n : String(n); }
function toISO(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function getMonday(d=new Date()){ const nd=new Date(d); const day = nd.getDay(); const diff = (day===0? -6 : 1) - day; nd.setDate(nd.getDate()+diff); nd.setHours(0,0,0,0); return nd; }
function weekDates(monday){ const arr = []; for(let i=0;i<7;i++){ const d = new Date(monday); d.setDate(monday.getDate()+i); arr.push(d); } return arr; }

function defaultWeekly(){ const monday = getMonday(); const days = weekDates(monday).map(d => ({ dateISO: toISO(d), types: {}, sessions: 0, sessionsList: [] })); return { weekOfISO: toISO(monday), weekNumber: 1, days, benchmarks: { Bike:3, Calves:4, Resistance:2, Cardio:2, Mobility:2, Other:1 }, customTypes: ['Bike','Calves','Rings'], typeCategories: { Bike: 'Cardio', Calves: 'None', Rings: 'Resistance' } }; }

function normalizeWeekly(w){ const customTypes = Array.from(new Set((w.customTypes||[]).map(s=>String(s).trim()).filter(Boolean))); const benchmarks = Object.assign({}, w.benchmarks||{}); customTypes.forEach(t=>{ if(!(t in benchmarks)) benchmarks[t]=0; }); const days = (w.days||[]).map(d=>{ const types = {}; Object.keys(d.types||{}).forEach(k=>{ const kk = String(k).trim(); if(!kk) return; types[kk] = !!d.types[k]; }); const rawList = Array.isArray(d.sessionsList)? d.sessionsList : []; const seen = new Set(); const sessionsList = []; rawList.forEach(s => { const key = s && s.id ? String(s.id) : JSON.stringify(s && s.sessionTypes ? s.sessionTypes : s); if(seen.has(key)) return; seen.add(key); sessionsList.push({ id: s && s.id, sessionTypes: Array.isArray(s && s.sessionTypes) ? s.sessionTypes : [] }); }); return Object.assign({}, d, { types, sessions: typeof d.sessions === 'number' ? d.sessions : (sessionsList.length || 0), sessionsList }); }); return Object.assign({}, w, { customTypes, benchmarks, days }); }

const weekly = normalizeWeekly(defaultWeekly());
// For demonstration: mark some checks
weekly.days[0].types.Bike = true;
weekly.days[2].types.Rings = true;
weekly.days[2].types.Calves = true;

const cleanedDays = weekly.days.map(d => { const types = {}; Object.keys(d.types||{}).forEach(k => { const kk = String(k).trim(); if(kk) types[kk] = !!d.types[k]; }); return Object.assign({}, d, { types }); });

const counts = {};
weekly.customTypes.forEach(t => counts[t] = 0);
cleanedDays.forEach(d => { Object.keys(d.types||{}).forEach(t => { if (d.types[t]) { if (!(t in counts)) counts[t] = 0; counts[t] += 1; } }); });

const today = toISO(new Date());
const todayDone = (() => { const td = cleanedDays.find(d=>d.dateISO===today); if(!td) return 0; return Object.keys(td.types||{}).filter(k => td.types[k]).length; })();
const weekDone = cleanedDays.reduce((acc,d) => acc + Object.keys(d.types||{}).filter(k => d.types[k]).length, 0);
const typeCats = weekly.typeCategories || {};
const resistanceCount = cleanedDays.reduce((acc,d) => acc + Object.keys(d.types||{}).filter(t => d.types[t] && typeCats[t] === 'Resistance').length, 0);
const cardioCount = cleanedDays.reduce((acc,d) => acc + Object.keys(d.types||{}).filter(t => d.types[t] && (typeCats[t] === 'Cardio' || t === 'Bike' || t === 'Cardio')).length, 0);

const out = { weekOfISO: weekly.weekOfISO, customTypes: weekly.customTypes, cleanedDays, counts, todayDone, weekDone, resistanceCount, cardioCount };
fs.writeFileSync('scripts/weekly-debug.json', JSON.stringify(out, null, 2));
console.log('wrote scripts/weekly-debug.json');

// Quick debug dump reproducing the WeeklyOverview counting logic
const fs = require('fs');
function pad(n){return n<10?`0${n}`:`${n}`}
function toISO(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function getMonday(d=new Date()){const nd=new Date(d);const day=nd.getDay();const diff=(day===0?-6:1)-day;nd.setDate(nd.getDate()+diff);nd.setHours(0,0,0,0);return nd}
function weekDates(monday){return Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return d})}
function defaultWeekly(){const monday=getMonday();const days=weekDates(monday).map(d=>({dateISO:toISO(d),types:{},sessions:0,sessionsList:[]}));return{weekOfISO:toISO(monday),weekNumber:1,days,benchmarks:{Bike:3,Calves:4,Resistance:2,Cardio:2,Mobility:2,Other:1},customTypes:["Bike","Calves","Rings"],typeCategories:{Bike:'Cardio',Calves:'None',Rings:'Resistance'}}}
function normalizeWeekly(w){const customTypes=Array.from(new Set((w.customTypes||[]).map(s=>String(s).trim()).filter(Boolean)));const benchmarks=Object.assign({},w.benchmarks||{});customTypes.forEach(t=>{if(!(t in benchmarks))benchmarks[t]=0});const days=(w.days||[]).map(d=>{const types={};Object.keys(d.types||{}).forEach(k=>{const kk=String(k).trim();if(!kk)return;types[kk]=!!d.types[k]});const rawList=Array.isArray(d.sessionsList)?d.sessionsList:[];const seen=new Set();const sessionsList=rawList.reduce((acc,s)=>{const key=s&&s.id?s.id:JSON.stringify((s&&s.sessionTypes)||s);if(seen.has(key))return acc;seen.add(key);acc.push({id:s&&s.id,sessionTypes:Array.isArray(s&&s.sessionTypes)?s.sessionTypes:[]});return acc;},[]);return {...d,types,sessions:typeof d.sessions==='number'?d.sessions:(sessionsList.length||0),sessionsList}});return {...w,customTypes,benchmarks,days};}

const w = normalizeWeekly(defaultWeekly());
// sample mutation: mark Bike checked on Monday and Rings on Wednesday
w.days[0].types.Bike = true; w.days[2].types.Rings = true; w.days[2].types.Calves = true;
const cleanedDays = w.days.map(d=>{const types={};Object.keys(d.types||{}).forEach(k=>{const kk=String(k).trim();if(kk)types[kk]=!!d.types[k]});return {...d,types}});
const counts = {};w.customTypes.forEach(t=>counts[t]=0);cleanedDays.forEach(d=>{Object.keys(d.types||{}).forEach(t=>{if(d.types[t]){if(!(t in counts))counts[t]=0;counts[t]+=1}})});
const today = toISO(new Date());
const todayDone = (()=>{const td=cleanedDays.find(d=>d.dateISO===today);if(!td)return 0;return Object.keys(td.types||{}).filter(k=>td.types[k]).length})();
const weekDone = cleanedDays.reduce((acc,d)=>acc+Object.keys(d.types||{}).filter(k=>d.types[k]).length,0);
const typeCats = w.typeCategories||{};
const resistanceCount = cleanedDays.reduce((acc,d)=>acc+Object.keys(d.types||{}).filter(t=>d.types[t] && typeCats[t]==='Resistance').length,0);
const cardioCount = cleanedDays.reduce((acc,d)=>acc+Object.keys(d.types||{}).filter(t=>d.types[t] && (typeCats[t]==='Cardio' || t==='Bike' || t==='Cardio')).length,0);
const out = { weekOfISO: w.weekOfISO, customTypes: w.customTypes, cleanedDays, counts, todayDone, weekDone, resistanceCount, cardioCount };
fs.writeFileSync('scripts/weekly-debug.json', JSON.stringify(out,null,2));
console.log('wrote scripts/weekly-debug.json');

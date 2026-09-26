/* SEN-FleetCare SW v34 — fix menu Dashboard/Plan Service utk nasrun, sync Backlog Register, double-click view Backlog */
const SW_VERSION='sen-fleetcare-v34-20260926-1000';
const CACHE_NAME=SW_VERSION;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['./','./index.html'])).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  const req=event.request; if(req.method!=='GET')return;
  const url=new URL(req.url); if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{try{return await fetch(req,{cache:'no-store'});}catch(_){return(await caches.match(req))||(await caches.match('./index.html'))||Response.error();}})());
});

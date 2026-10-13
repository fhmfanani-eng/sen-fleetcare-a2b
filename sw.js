/* SEN-FleetCare SW v68 — Native views + Notifikasi + Web Push (HP & desktop) */
const SW_VERSION='sen-fleetcare-v68-20261013-push';
const CACHE_NAME=SW_VERSION;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(['./','./index.html'])).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  const req=event.request; if(req.method!=='GET')return;
  const url=new URL(req.url); if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{try{return await fetch(req,{cache:'no-store'});}catch(_){return(await caches.match(req))||(await caches.match('./index.html'))||Response.error();}})());
});

/* Klik notifikasi: fokuskan tab/aplikasi yang sudah terbuka lalu minta halaman tujuan dibuka;
   bila aplikasi tertutup, buka baru dengan ?notif=<view>. */
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const view=(event.notification.data&&event.notification.data.view)||'';
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of list){
      if('focus' in c){
        try{ await c.focus(); }catch(_){}
        c.postMessage({type:'notif-click',view});
        return;
      }
    }
    if(clients.openWindow){
      const base=new URL('./',self.registration.scope).href;
      await clients.openWindow(view?base+'?notif='+encodeURIComponent(view):base);
    }
  })());
});

/* Web Push sungguhan (server → HP saat aplikasi tertutup). Aktif bila suatu saat ada server push;
   payload JSON: {title, body, view, tag}. Tanpa server push, handler ini tidak pernah terpanggil. */
self.addEventListener('push',event=>{
  let d={}; try{ d=event.data?event.data.json():{}; }catch(_){ d={body:event.data?event.data.text():''}; }
  event.waitUntil(self.registration.showNotification(d.title||'SEN-FleetCare',{
    body:d.body||'', tag:d.tag||'fleetcare-push', icon:'icon-192.png', badge:'icon-192.png',
    vibrate:[200,100,200], data:{view:d.view||''}
  }));
});

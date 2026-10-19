/* External browser GPS bridge: only 127.0.0.1, no tab or app switching. */
(function(){
 'use strict';
 if(location.hostname!=='127.0.0.1'||location.port!=='48764')return;
 var current={running:false,ageMs:null,gaps:0,accuracyMeters:null,unresolvedGap:false};
 var inFlight=false,MAX_WAIT=30000;
 var latestWaitMessage='GPS受信を待っています';
 function sync(){
  fetch('/api/status',{cache:'no-store',credentials:'omit'})
  .then(function(r){if(!r.ok)throw Error('GPS接続失敗');return r.json();})
  .then(function(x){current=x;})
  .catch(function(){current={running:false,ageMs:null,gaps:0,accuracyMeters:null,unresolvedGap:false};});
 }
 function err(nonce,message){
  if(window.DistanceLab)window.DistanceLab.onNativeError(nonce,message);
 }
 sync();setInterval(sync,1500);
 window.DistanceNative={
  getStatus:function(){return JSON.stringify(current);},
  requestCapture:function(nonce,target){
   if(inFlight){err(nonce,'別のGPS取得を処理中です');return;}
   inFlight=true;
   var begun=Date.now(),uri='/api/capture?nonce='+encodeURIComponent(nonce)+'&target='+encodeURIComponent(target);
   function attempt(){
    fetch(uri,{cache:'no-store',credentials:'omit'})
    .then(function(r){if(!r.ok)throw Error('距離を取得できません');return r.json();})
    .then(function(d){
     if(d.message && typeof d.message==='string'){
      latestWaitMessage=d.message;
      if(window.DistanceLab&&typeof window.DistanceLab.onNativePending==='function')
       window.DistanceLab.onNativePending(nonce,d.message);
     }
     if(d.ready&&d.snapshot){
      inFlight=false;
      if(window.DistanceLab)window.DistanceLab.onNativeSnapshot(JSON.stringify(d.snapshot));
     }else if(Date.now()-begun>=MAX_WAIT){
      inFlight=false;err(nonce,'GPS再取得できませんでした：'+(d.message||latestWaitMessage));
     }else setTimeout(attempt,750);
    })
    .catch(function(e){
     if(Date.now()-begun>=MAX_WAIT){inFlight=false;err(nonce,'GPSアプリへの接続に失敗：'+e.message);}
     else setTimeout(attempt,750);
    });
   }
   attempt();
  }
 };
})();
